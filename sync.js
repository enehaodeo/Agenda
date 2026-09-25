/* ============================================================
   日程 · 账号与云同步   sync.js
   普通 script（不是 module），在 app.js 之前加载。
   这里只定义常量和函数；state / save / renderAll / toast / drag 这些
   app.js 的全局都在「调用时」才解析，所以放前面没问题。
   初始化（绑事件、首次同步）由 app.js 末尾调用 syncBoot()。
   未登录时本文件不发任何网络请求。
   ============================================================ */
'use strict';

/* ---------------------------------------------------------- 配置
   Supabase 控制台 → Project Settings → API：Project URL 与 anon / publishable key。
   anon key 本来就是公开的，数据安全靠数据库的行级权限（见 supabase/schema.sql）。
   两项留空 = 不启用云同步，App 照旧纯本地。 */
const SUPABASE_URL  = 'https://sfrlewqhrdnflcvbdadx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_wN_-iKX469amyEkafeMrHg_0bhIJWVC';
const CLOUD_READY = !!(SUPABASE_URL && SUPABASE_ANON);

/* ---------------------------------------------------------- 存储键
   agenda.v1                访客（未登录）数据，与旧版完全一致
   agenda.acct.v1           登录会话
   agenda.u.<uid>.v1        该账号在本机的工作副本
   agenda.u.<uid>.sync.v1   {base, rev, at}：base = 上次同步成功时的数据，三方合并的公共祖先 */
const GUEST_KEY = 'agenda.v1';
const ACCT_KEY  = 'agenda.acct.v1';
const userKey = id => `agenda.u.${id}.v1`;
const syncKey = id => `agenda.u.${id}.sync.v1`;
/* 参与同步的集合；ui（当前日期、缩放）属于这台设备，不同步 */
const DATA_KEYS = ['tasks', 'blocks', 'slots', 'tags', 'log'];

function readAcct() {
  try {
    const a = JSON.parse(localStorage.getItem(ACCT_KEY));
    return a && a.user && a.user.id ? a : null;
  } catch (e) { return null; }
}
let acct = readAcct();
const storeKey = () => acct ? userKey(acct.user.id) : GUEST_KEY;

function setAcct(tok) {
  if (!tok) { acct = null; try { localStorage.removeItem(ACCT_KEY); } catch (e) { } return; }
  acct = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: tok.expires_at || Math.floor(Date.now() / 1000) + (tok.expires_in || 3600),
    user: { id: tok.user.id, email: tok.user.email },
  };
  persistAcct();
}
const persistAcct = () => { try { localStorage.setItem(ACCT_KEY, JSON.stringify(acct)); } catch (e) { } };

/* ============================================================
   数据工具（纯函数，不碰 DOM 和全局 state，便于单测）
   ============================================================ */
/** 取出参与同步的五个集合，深拷贝——之后 state 再怎么原地改都影响不到它 */
function dataOf(s) {
  const o = {};
  for (const k of DATA_KEYS) o[k] = Array.isArray(s && s[k]) ? s[k] : [];
  return JSON.parse(JSON.stringify(o));
}
function sameData(a, b) {
  if (!a || !b) return a === b;
  return DATA_KEYS.every(k => JSON.stringify(a[k] || []) === JSON.stringify(b[k] || []));
}
const sameRec = (a, b) => (!a || !b) ? a === b : JSON.stringify(a) === JSON.stringify(b);
const byId = list => new Map((list || []).map(r => [r.id, r]));

/**
 * 三方合并：base 是两边上次一致时的样子，按记录 id 逐条判断。
 *   只有一边改了（含删除）→ 用改了的那边
 *   两边都改了           → 比记录上的 mt（修改时间），取新的
 *   一边删、一边改       → 保留改过的，宁可多不可丢
 * 顺序：先按 a 的顺序，b 独有的接在后面（新任务出现在末尾，和本机新建一致）。
 */
function merge3(base, a, b) {
  const out = {};
  for (const k of DATA_KEYS) {
    const B = byId(base && base[k]), A = byId(a && a[k]), R = byId(b && b[k]);
    const order = [...A.keys()];
    for (const id of R.keys()) if (!A.has(id)) order.push(id);
    for (const id of B.keys()) if (!A.has(id) && !R.has(id)) order.push(id);
    const list = [];
    for (const id of order) {
      const o = B.get(id), x = A.get(id), y = R.get(id);
      const xc = !sameRec(x, o), yc = !sameRec(y, o);
      let v;
      if (!xc) v = y;
      else if (!yc) v = x;
      else if (!x) v = y;
      else if (!y) v = x;
      else v = (y.mt || 0) > (x.mt || 0) ? y : x;
      if (v) list.push(v);
    }
    out[k] = list;
  }
  return out;
}

/**
 * 合并后修复不变量：两台设备各自合法，合在一起不一定合法。
 *   - 子任务指向已删的父任务、或父任务自己也有父 → 变顶层（只允许一层）
 *   - block 的任务已删、任务是父任务、同一任务多个 block（留 mt 新的）→ 删
 *   - 同一天的可用时间段重叠 / 相邻 → 合并
 *   - 被这次合并碰过的日子里：block 时长跟着任务走，
 *     互相重叠或出了可用时间的，mt 较旧的那个撤回待办
 * prev 是合并前的本地数据，用来圈出"被碰过的日子"，没动过的日子原样不查。
 * 返回 {data, bumped: [被撤回待办的任务名]}
 */
function repairData(d, prev) {
  const bumped = [];
  const T0 = byId(d.tasks);
  d.tasks = d.tasks.map(t => {
    if (!t.parentId) return t;
    const p = T0.get(t.parentId);
    return (!p || p.parentId) ? { ...t, parentId: null } : t;
  });
  const T = byId(d.tasks);
  const parents = new Set(d.tasks.filter(t => t.parentId).map(t => t.parentId));

  /* block：孤儿、挂在父任务上的、重复的 */
  const one = new Map();
  for (const b of d.blocks) {
    const t = T.get(b.taskId);
    if (!t || parents.has(t.id)) continue;
    const o = one.get(b.taskId);
    if (!o || (b.mt || 0) > (o.mt || 0)) one.set(b.taskId, b);
  }
  d.blocks = d.blocks.filter(b => one.get(b.taskId) === b);

  /* 时间段：同日重叠 / 相邻的合并（与 app.js mergeSlots 同一规则） */
  const byDate = new Map();
  for (const s of d.slots) (byDate.get(s.date) || byDate.set(s.date, []).get(s.date)).push(s);
  const slots = [];
  for (const list of byDate.values()) {
    list.sort((x, y) => x.start - y.start);
    let last = null;
    for (const s of list) {
      if (last && s.start <= last.end) {
        if (s.end > last.end) { last.end = s.end; last.mt = Math.max(last.mt || 0, s.mt || 0); }
      } else { last = { ...s }; slots.push(last); }
    }
  }
  d.slots = slots;

  /* 圈出被碰过的日子 */
  const touched = new Set();
  const diffDates = (k, dateOf) => {
    const P = byId(prev && prev[k]), N = byId(d[k]);
    for (const id of new Set([...P.keys(), ...N.keys()])) {
      const p = P.get(id), n = N.get(id);
      if (sameRec(p, n)) continue;
      for (const x of [p, n]) { const dk = x && dateOf(x); if (dk) touched.add(dk); }
    }
  };
  diffDates('slots', s => s.date);
  diffDates('blocks', b => b.date);
  const blockOfTask = new Map(d.blocks.map(b => [b.taskId, b]));
  diffDates('tasks', t => blockOfTask.get(t.id)?.date);

  /* 逐日校验：新改的先占位，旧的让路 */
  const drop = new Set(), fix = new Map();
  for (const dk of touched) {
    const ss = d.slots.filter(s => s.date === dk);
    const bs = d.blocks.filter(b => b.date === dk).sort((x, y) => (y.mt || 0) - (x.mt || 0));
    const kept = [];
    for (const b of bs) {
      const t = T.get(b.taskId);
      const dur = Math.max(1, +t.minutes || 0);
      const nb = b.end - b.start === dur ? b : { ...b, end: b.start + dur };
      const inSlot = ss.some(s => nb.start >= s.start && nb.end <= s.end);
      const clash = kept.some(k => nb.start < k.end && nb.end > k.start);
      if (inSlot && !clash && nb.end <= 1440) { kept.push(nb); if (nb !== b) fix.set(b.id, nb); }
      else { drop.add(b.id); bumped.push(t.title); }
    }
  }
  d.blocks = d.blocks.filter(b => !drop.has(b.id)).map(b => fix.get(b.id) || b);
  return { data: d, bumped };
}

/* ---------------------------------------------------------- 修改时间 mt
   每次 save() 时拿每条记录与上次保存时的样子比，变了的盖上 mt = 现在。
   这样三方合并在"两边都改了"时有据可依，又不用去改散落各处的写操作。 */
let recSigs = new Map();
const recSig = r => JSON.stringify(r, (k, v) => k === 'mt' ? undefined : v);
function resetSigs() {
  recSigs = new Map();
  for (const k of DATA_KEYS) for (const r of state[k]) recSigs.set(k + ':' + r.id, { sig: recSig(r), mt: r.mt });
}
/** 返回这次保存相对上次有没有数据改动（ui 的改动不算） */
function stampChanges() {
  const now = Date.now(), next = new Map();
  let changed = false;
  for (const k of DATA_KEYS) for (const r of state[k]) {
    const key = k + ':' + r.id, sig = recSig(r), p = recSigs.get(key);
    if (!p || p.sig !== sig) { r.mt = now; changed = true; }
    else if (r.mt === undefined && p.mt !== undefined) r.mt = p.mt;   /* mergeSlots 之类重建对象时会丢掉 mt */
    next.set(key, { sig, mt: r.mt });
  }
  if (!changed) for (const key of recSigs.keys()) if (!next.has(key)) { changed = true; break; }
  recSigs = next;
  return changed;
}

/* ============================================================
   Supabase 薄客户端：直接 fetch 它的 REST 接口，不引入 supabase-js
   ============================================================ */
class CloudError extends Error {
  constructor(kind, status, msg, code) { super(msg); this.kind = kind; this.status = status; this.code = code; }
}
const AUTH_ERR = {
  invalid_credentials: '邮箱或密码不对',
  invalid_grant: '邮箱或密码不对',
  email_not_confirmed: '这个邮箱还没验证：点「注册」重新填一次，会再发验证码',
  user_already_exists: '这个邮箱已经注册过了，直接登录或找回密码',
  email_exists: '这个邮箱已经注册过了，直接登录或找回密码',
  weak_password: '密码太简单，至少 6 位',
  otp_expired: '验证码不对或已过期',
  otp_disabled: '服务器没有开启验证码登录',
  over_email_send_rate_limit: '发信太频繁，请过一会儿再试',
  over_request_rate_limit: '请求太频繁，请稍后再试',
  signup_disabled: '暂未开放注册',
  email_address_invalid: '邮箱地址无效',
  email_address_not_authorized: '服务器还没配置发信（SMTP），暂时发不了邮件',
  validation_failed: '填写的格式不对',
  same_password: '新密码不能和旧密码相同',
  user_not_found: '账号不存在',
  refresh_token_not_found: '登录已过期，请重新登录',
  refresh_token_already_used: '登录已过期，请重新登录',
  session_not_found: '登录已过期，请重新登录',
};
function errText(d, status) {
  const code = d && (d.error_code || d.code || d.error);
  if (AUTH_ERR[code]) return AUTH_ERR[code];
  const msg = d && (d.msg || d.message || d.error_description || d.error);
  if (/invalid login credentials/i.test(msg || '')) return AUTH_ERR.invalid_credentials;
  if (status === 429) return AUTH_ERR.over_request_rate_limit;
  return msg ? String(msg) : `服务器返回 ${status}`;
}

async function cloudFetch(path, { method = 'GET', body, auth = true, retry = true } = {}) {
  if (auth) await ensureFresh();
  const headers = { apikey: SUPABASE_ANON };
  if (auth) headers.Authorization = 'Bearer ' + acct.access_token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(SUPABASE_URL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) { throw new CloudError('offline', 0, '连不上同步服务器'); }
  if (res.status === 401 && auth && retry) {
    await ensureFresh(true);
    return cloudFetch(path, { method, body, auth, retry: false });
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) throw new CloudError('http', res.status, errText(data, res.status), data && (data.error_code || data.code));
  return data;
}

/* access token 过期前一分钟换新；同一时刻只换一次 */
let refreshing = null;
async function ensureFresh(force) {
  if (!acct) throw new CloudError('auth', 401, '未登录');
  if (acct.expired) throw new CloudError('auth', 401, '登录已过期，请重新登录');
  /* 别的标签页可能刚换过：refresh token 是一次性的，用磁盘上更新的那份 */
  const disk = readAcct();
  if (disk && disk.user.id === acct.user.id && disk.expires_at > acct.expires_at) acct = disk;
  if (!force && acct.expires_at * 1000 - Date.now() > 60000) return;
  if (!refreshing) refreshing = (async () => {
    try {
      const tok = await cloudFetch('/auth/v1/token?grant_type=refresh_token',
        { method: 'POST', body: { refresh_token: acct.refresh_token }, auth: false });
      setAcct(tok);
    } catch (e) {
      if (e.kind === 'http' && (e.status === 400 || e.status === 401 || e.status === 403)) {
        acct.expired = true; persistAcct();
        e.kind = 'auth';
      }
      throw e;
    } finally { refreshing = null; }
  })();
  return refreshing;
}

const authApi = {
  signIn: (email, password) => cloudFetch('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, auth: false }),
  signUp: (email, password) => cloudFetch('/auth/v1/signup', { method: 'POST', body: { email, password }, auth: false }),
  resend: email => cloudFetch('/auth/v1/resend', { method: 'POST', body: { type: 'signup', email }, auth: false }),
  verify: (type, email, token) => cloudFetch('/auth/v1/verify', { method: 'POST', body: { type, email, token }, auth: false }),
  recover: email => cloudFetch('/auth/v1/recover', { method: 'POST', body: { email }, auth: false }),
  setPassword: password => cloudFetch('/auth/v1/user', { method: 'PUT', body: { password } }),
  signOut: () => cloudFetch('/auth/v1/logout', { method: 'POST' }),
  deleteMe: () => cloudFetch('/rest/v1/rpc/delete_me', { method: 'POST', body: {} }),
};

async function pullRemote() {
  const rows = await cloudFetch(`/rest/v1/agendas?select=doc,rev&user_id=eq.${acct.user.id}`);
  const r = Array.isArray(rows) ? rows[0] : null;
  return r ? { doc: dataOf(r.doc), rev: +r.rev } : null;
}
async function pushRemote(doc, baseRev) {
  const r = await cloudFetch('/rest/v1/rpc/push_agenda', { method: 'POST', body: { p_doc: doc, p_base_rev: baseRev } });
  return +r;
}

function readMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(syncKey(acct.user.id)));
    if (m) return { base: m.base ? dataOf(m.base) : null, rev: +m.rev || 0, at: m.at || 0 };
  } catch (e) { }
  return { base: null, rev: 0, at: 0 };
}
function writeMeta(m) {
  try { localStorage.setItem(syncKey(acct.user.id), JSON.stringify(m)); }
  catch (e) { toast('保存同步记录失败：浏览器存储空间不足'); }
}
const isDirty = () => !!acct && !sameData(dataOf(state), readMeta().base);

/* ============================================================
   同步引擎
   save() 有数据改动 → cloudDirty() 防抖 1.5 秒 → cloudSync()
   另外：联网、页面回到前台、前台每 60 秒各拉一次，别的设备的改动才过得来。
   ============================================================ */
let syncing = null, syncAgain = false, syncTimer = 0;
let cloudState = 'idle', cloudMsg = '';

function cloudDirty() {
  if (!acct || !CLOUD_READY) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(cloudSync, 1500);
}
/** 单飞：正在同步时再叫一次，就等这轮完了再补一轮 */
function cloudSync() {
  if (!acct || acct.expired || !CLOUD_READY) return Promise.resolve();
  if (syncing) { syncAgain = true; return syncing; }
  syncing = (async () => {
    try {
      do { syncAgain = false; await syncOnce(); } while (syncAgain);
    } catch (e) {
      if (e.kind === 'offline') goOffline();
      else if (acct && acct.expired) setCloudState('relogin');
      else setCloudState('error', e.message);
    } finally { syncing = null; }
  })();
  return syncing;
}

async function syncOnce() {
  if (!navigator.onLine) return goOffline();
  setCloudState('syncing');
  const bumped = [];
  for (let round = 0; round < 4; round++) {
    const meta = readMeta();
    const remote = await pullRemote();
    let local = dataOf(state);                      /* 拉完再取：await 期间本机可能又改了 */

    if (remote && remote.rev !== meta.rev) {       /* 别的设备写过：先合并 */
      const r = repairData(merge3(meta.base, local, remote.doc), local);
      bumped.push(...r.bumped);
      if (!sameData(r.data, local)) {
        if (drag) {                                 /* 拖拽中不动 state，稍后再来 */
          clearTimeout(syncTimer); syncTimer = setTimeout(cloudSync, 1500);
          return setCloudState(cloudState === 'syncing' ? 'idle' : cloudState);
        }
        adoptData(r.data);
        local = dataOf(state);
      }
      if (sameData(local, remote.doc)) { writeMeta({ base: local, rev: remote.rev, at: Date.now() }); return synced(bumped); }
    } else if (remote && sameData(local, meta.base)) {
      writeMeta({ ...meta, at: Date.now() });
      return synced(bumped);                        /* 两边都没动 */
    }

    const rev = await pushRemote(local, remote ? remote.rev : 0);
    if (rev < 0) continue;                          /* 推送途中又有设备写入：重来 */
    writeMeta({ base: local, rev, at: Date.now() });
    return synced(bumped);
  }
  throw new CloudError('http', 409, '多台设备同时在改，稍后自动重试');
}
function synced(bumped) {
  setCloudState('synced');
  if (bumped.length) toast(`同步时有 ${bumped.length} 项安排和别的设备冲突，已放回待办：${bumped.slice(0, 3).join('、')}${bumped.length > 3 ? ' 等' : ''}`);
}

/** 用合并结果替换本机数据。旧的撤销快照不含别的设备的改动，撤销会把它们吞掉，所以清空 */
function adoptData(d) {
  for (const k of DATA_KEYS) state[k] = d[k];
  if (!state.tags.length) state.tags = DEFAULT_TAGS.map(t => ({ ...t }));
  resetSigs();
  writeLocal();
  undoStack.length = 0;
  resetNewTag(); renderAll();
  if (rdlg.open) renderReview();
}

function goOffline() {
  if (cloudState !== 'offline' && acct) toast('已离线：改动会先存在本机，联网后自动同步');
  setCloudState('offline');
}

/* ============================================================
   登录 / 退出 / 访客数据
   ============================================================ */
/** 切换到当前账号（或访客）的那份本地数据 */
function switchStore() {
  STORE = storeKey();
  state = loadState();
  undoStack.length = 0;
  resetSigs(); resetNewTag(); renderAll(); scrollToNow(false);
  cloudState = 'idle';
  renderAcct();
}

async function onSignedIn(tok) {
  const prevId = acct && acct.user.id;
  setAcct(tok);
  const id = acct.user.id;
  let hasCopy = false;
  try { hasCopy = localStorage.getItem(userKey(id)) !== null; } catch (e) { }
  /* 这台设备第一次登这个账号：有云端数据就直接拿来当本机副本 */
  if (!hasCopy) {
    let remote = null;
    try { remote = await pullRemote(); } catch (e) { }
    if (remote) {
      const s = normState({ ...remote.doc, ui: { zoom: state.ui.zoom } });
      try { localStorage.setItem(userKey(id), JSON.stringify(s)); } catch (e) { }
      writeMeta({ base: dataOf(s), rev: remote.rev, at: Date.now() });
    }
  }
  if (prevId !== id || !hasCopy) switchStore();
  toast(`已登录 ${acct.user.email}`);
  offerGuest();
  cloudSync();
}

function guestData() {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return null;
    const g = dataOf(JSON.parse(raw));
    const n = g.tasks.length + g.blocks.length + g.slots.length + g.log.length;
    return n ? { raw, data: g, tasks: g.tasks.length } : null;
  } catch (e) { return null; }
}
const guestLabel = g => g.tasks ? `${g.tasks} 项任务` : '一些时间安排';
function offerGuest() {
  const g = acct && guestData();
  if (g) toast(`本机还有未登录时记下的 ${guestLabel(g)}，要并入这个账号吗？`, { label: '并入账号', fn: mergeGuest });
}
function mergeGuest() {
  const g = guestData();
  if (!g || !acct) return;
  snapshot();
  const cur = dataOf(state);
  const { data, bumped } = repairData(merge3(dataOf(blank()), cur, g.data), cur);
  for (const k of DATA_KEYS) state[k] = data[k];
  save();                                          /* 并进来的都算本机新改动，会盖 mt 并触发同步 */
  try { localStorage.removeItem(GUEST_KEY); } catch (e) { }
  resetNewTag(); renderAll();
  if ($('#acctDialog').open) renderAcctDlg();
  toast(`已并入 ${guestLabel(g)}${bumped.length ? `，${bumped.length} 项安排冲突已放回待办` : ''}`, {
    label: '撤销', fn: () => { undo(); try { localStorage.setItem(GUEST_KEY, g.raw); } catch (e) { } },
  });
}

async function signOut() {
  if (!acct) return;
  const wipe = !acct.expired && $('#aWipe').checked;
  if (navigator.onLine && !acct.expired) { try { await cloudSync(); } catch (e) { } }
  const dirty = isDirty();
  if (dirty && wipe) return acctNote('还有改动没同步到云端，先联网同步，再清除本机数据', true);
  if (!acct.expired) { try { await authApi.signOut(); } catch (e) { } }
  const id = acct.user.id;
  setAcct(null);
  if (wipe) { try { localStorage.removeItem(userKey(id)); localStorage.removeItem(syncKey(id)); } catch (e) { } }
  switchStore();
  $('#acctDialog').close();
  toast(dirty ? '已退出。还有改动没同步，保留在本机，下次登录会接着同步' : '已退出登录');
}

async function deleteAccount() {
  if (!acct) return;
  try { await authApi.deleteMe(); }
  catch (e) { return toast('注销失败：' + e.message); }
  const id = acct.user.id;
  setAcct(null);
  try { localStorage.removeItem(userKey(id)); localStorage.removeItem(syncKey(id)); } catch (e) { }
  switchStore();
  if ($('#acctDialog').open) $('#acctDialog').close();
  toast('账号已注销，云端数据已删除');
}

/* ============================================================
   界面：报头的账号 / 同步状态按钮 + 账号对话框
   ============================================================ */
const hhmm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const CLOUD_LABEL = { idle: '账号', syncing: '同步中', synced: '已同步', offline: '离线', error: '未同步', relogin: '需登录' };

function setCloudState(st, msg) {
  cloudState = st; cloudMsg = msg || '';
  renderAcct();
}
function cloudLine() {
  const at = readMeta().at;
  const dirty = isDirty();
  switch (cloudState) {
    case 'syncing': return '正在同步…';
    case 'synced': return `已同步 · ${at ? hhmm(at) : '刚刚'}`;
    case 'offline': return `离线：改动已存在本机，联网后自动同步${dirty ? '（有未同步的改动）' : ''}`;
    case 'error': return `同步失败：${cloudMsg}${dirty ? '（改动已存在本机）' : ''}`;
    case 'relogin': return '登录已过期，重新登录后继续同步（本机数据都在）';
    default: return at ? `上次同步 ${hhmm(at)}` : '尚未同步';
  }
}
function renderAcct() {
  const b = $('#btnAcct');
  if (!b) return;
  if (!acct) {
    b.dataset.st = '';
    b.textContent = '登录';
    b.title = CLOUD_READY ? '登录后可在多台设备之间同步' : '云同步未配置（见 README）';
  } else {
    const st = acct.expired ? 'relogin' : cloudState;
    b.dataset.st = st;
    b.innerHTML = `<i class="acct-dot"></i>${CLOUD_LABEL[st]}`;
    b.title = `${acct.user.email} · ${cloudLine()}`;
  }
  if ($('#acctDialog').open) renderAcctDlg();
}

let acctMode = 'in', acctEmail = '', acctBusy = false;
const ACCT_TITLE = { in: '登录', up: '注册', 'up-code': '注册 · 验证邮箱', reset: '找回密码', 'reset-code': '找回密码 · 设新密码' };
const ACCT_SUBMIT = { in: '登录', up: '注册', 'up-code': '验证', reset: '发送验证码', 'reset-code': '重设密码并登录' };

function acctNote(html, err) {
  const el = $('#acctNote');
  el.innerHTML = html;
  el.classList.toggle('err', !!err);
}
function renderAcctDlg() {
  const inOK = !!acct && !acct.expired;
  $('#acctOut').hidden = inOK;
  $('#acctIn').hidden = !inOK;
  $('#aDelete').hidden = $('#aSyncNow').hidden = !inOK;
  $('#aOut').hidden = !acct;                        /* 登录过期时也要能退出，回到访客数据 */
  $('#aSubmit').hidden = inOK;
  if (inOK) {
    $('#acctTitle').textContent = '账号';
    $('#aWho').textContent = acct.user.email;
    $('#aSync').textContent = cloudLine();
    const g = guestData();
    $('#aGuest').hidden = !g;
    if (g) $('#aGuestN').textContent = guestLabel(g);
    return;
  }
  const m = acctMode, code = m.endsWith('code');
  $('#acctTitle').textContent = ACCT_TITLE[m];
  $$('#acctTabs button').forEach(x => x.classList.toggle('on', m.startsWith(x.dataset.m)));
  $('#aPwdField').hidden = m === 'up-code' || m === 'reset';
  $('#aPwdLbl').textContent = m === 'reset-code' ? '新密码' : '密码';
  $('#aPwd').autocomplete = m === 'in' ? 'current-password' : 'new-password';
  $('#aCodeField').hidden = !code;
  $('#aEmail').disabled = code;
  $('#aSubmit').textContent = acctBusy ? '请稍候…' : ACCT_SUBMIT[m];
  $('#aSubmit').disabled = acctBusy;
  const resend = `<button type="button" class="note-btn" data-resend>重新发送</button>`;
  acctNote({
    in: acct && acct.expired ? '登录已过期，重新登录即可继续同步，本机数据都在。' : '登录后，日程会在你的各台设备之间自动同步。',
    up: '密码至少 6 位。注册后会往邮箱发一个验证码。',
    'up-code': `验证码已发到 ${esc(acctEmail)}，可能在垃圾邮件里。${resend}`,
    reset: '填注册时用的邮箱，会发一个验证码过去。',
    'reset-code': `验证码已发到 ${esc(acctEmail)}，填上它和新密码。${resend}`,
  }[m]);
}
function openAcct() {
  if (!CLOUD_READY && !acct) return toast('还没配置云同步：在 sync.js 顶部填入 Supabase 的地址和 key（见 README）');
  if (acct && acct.expired) { acctMode = 'in'; $('#aEmail').value = acct.user.email; }
  $('#aCode').value = ''; $('#aPwd').value = ''; $('#aWipe').checked = false;
  renderAcctDlg();
  $('#acctDialog').showModal();
}

async function acctSubmit(e) {
  e.preventDefault();
  if (acctBusy) return;
  const m = acctMode;
  const email = (m.endsWith('code') ? acctEmail : $('#aEmail').value).trim().toLowerCase();
  const pwd = $('#aPwd').value, code = $('#aCode').value.replace(/\s/g, '');
  if (!/^\S+@\S+\.\S+$/.test(email)) return acctNote('邮箱格式不对', true);
  if ((m === 'in' || m === 'up' || m === 'reset-code') && !pwd) return acctNote(m === 'reset-code' ? '填一个新密码' : '密码不能为空', true);
  if ((m === 'up' || m === 'reset-code') && pwd.length < 6) return acctNote('密码至少 6 位', true);
  if (m.endsWith('code') && !code) return acctNote('填上邮件里的验证码', true);

  acctBusy = true; renderAcctDlg();
  let done = false;
  try {
    if (m === 'in') { await onSignedIn(await authApi.signIn(email, pwd)); done = true; }
    else if (m === 'up') {
      const r = await authApi.signUp(email, pwd);
      if (r && r.access_token) { await onSignedIn(r); done = true; }          /* 项目没开邮箱验证时直接给会话 */
      else { acctEmail = email; acctMode = 'up-code'; }
    }
    else if (m === 'up-code') { await onSignedIn(await authApi.verify('signup', email, code)); done = true; }
    else if (m === 'reset') { await authApi.recover(email); acctEmail = email; acctMode = 'reset-code'; }
    else if (m === 'reset-code') {
      await onSignedIn(await authApi.verify('recovery', email, code));
      done = true;
      try { await authApi.setPassword(pwd); toast('新密码已生效'); }
      catch (err) { toast('已登录，但新密码没设上：' + err.message); }
    }
  } catch (err) {
    acctBusy = false; renderAcctDlg();
    return acctNote(err.kind === 'offline' ? '连不上服务器，检查一下网络' : esc(err.message), true);
  }
  acctBusy = false;
  if (done) { acctMode = 'in'; $('#aPwd').value = ''; $('#aCode').value = ''; $('#acctDialog').close(); }
  else { renderAcctDlg(); (acctMode.endsWith('code') ? $('#aCode') : $('#aEmail')).focus(); }
}

/* ============================================================
   启动：由 app.js 末尾调用
   ============================================================ */
function syncBoot() {
  $('#btnAcct').onclick = openAcct;
  $('#acctForm').addEventListener('submit', acctSubmit);
  $('#acctTabs').onclick = e => {
    const b = e.target.closest('button[data-m]'); if (!b || acctBusy) return;
    acctMode = b.dataset.m; renderAcctDlg(); $('#aEmail').focus();
  };
  $('#acctNote').onclick = async e => {
    if (!e.target.closest('[data-resend]') || acctBusy) return;
    try {
      await (acctMode === 'up-code' ? authApi.resend(acctEmail) : authApi.recover(acctEmail));
      acctNote('已重新发送，请查收。');
    } catch (err) { acctNote(esc(err.message), true); }
  };
  $('#aClose').onclick = () => $('#acctDialog').close();
  $('#aSyncNow').onclick = () => { if (!navigator.onLine) return goOffline(); cloudSync(); };
  $('#aOut').onclick = signOut;
  $('#aMerge').onclick = mergeGuest;
  $('#aDelete').onclick = () => {
    $('#acctDialog').close();
    toast('注销后，云端数据会被永久删除，无法恢复', { label: '确认注销', fn: deleteAccount });
  };

  window.addEventListener('offline', () => { if (acct && !acct.expired) goOffline(); });
  window.addEventListener('online', () => {
    if (!acct || acct.expired) return;
    toast('已联网，正在同步');
    cloudSync();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) cloudSync(); });
  setInterval(() => { if (!document.hidden) cloudSync(); }, 60000);

  /* 同一浏览器开了多个标签页：别的页写了数据 / 换了账号，这边跟上，
     否则这页拿着旧 state 再保存一次，就把那边的改动盖掉了（同步时还会被当成"删除"推上去） */
  window.addEventListener('storage', e => {
    if (e.key === ACCT_KEY) {
      const n = readAcct();
      const changed = (n && n.user.id) !== (acct && acct.user.id);
      acct = n;
      if (changed) switchStore(); else renderAcct();
      return;
    }
    if (e.key === STORE && e.newValue && !drag) {
      try {
        const s = normState(JSON.parse(e.newValue));
        for (const k of DATA_KEYS) state[k] = s[k];
        resetSigs(); resetNewTag(); renderAll();
      } catch (err) { }
    }
  });

  renderAcct();
  if (acct && acct.expired) setCloudState('relogin');
  else cloudSync();
}
