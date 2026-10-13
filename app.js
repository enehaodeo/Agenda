/* ============================================================
   日程 · 手工排程   app.js
   纯前端，无依赖，数据存 localStorage；登录后的云同步见 sync.js
   ============================================================ */
'use strict';

/* ---------------------------------------------------------- 工具 */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad = n => String(n).padStart(2, '0');
const SNAP = 5;
const snap = m => Math.round(m / SNAP) * SNAP;

const fmtT = m => `${pad(Math.floor(m / 60) % 24)}:${pad(Math.floor(m) % 60)}`;
const fmtD = m => {
  const h = Math.floor(m / 60), mm = m % 60;
  if (h && mm) return `${h} 时 ${mm} 分`;
  if (h) return `${h} 时`;
  return `${mm} 分`;
};
const fmtDH = m => {
  const h = Math.floor(m / 60), mm = m % 60;
  return (h ? `${h}<small>时</small>` : '') + `${mm}<small>分</small>`;
};
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => keyOf(new Date());
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
const cnDate = k => { const d = dateOf(k); return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 星期${WEEK[d.getDay()]}`; };
const shortDate = k => { const d = dateOf(k); return `${d.getMonth() + 1}/${d.getDate()}`; };
const midDate = k => { const d = dateOf(k); return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${WEEK[d.getDay()]}`; };
const shiftKey = (k, n) => { const d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hexRgb = h => {
  const x = h.replace('#', '');
  const n = parseInt(x.length === 3 ? x.split('').map(c => c + c).join('') : x, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};
/** 颜料提亮：#B23A22 这类深颜料压在夜色上会糊掉，抬明度、稍收饱和度后再用 */
function lighten(hex) {
  const [r, g, b] = hexRgb(hex).split(',').map(n => +n / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let l = (mx + mn) / 2, s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  s = Math.min(s * .92, .66);
  l = .52 + l * .28;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return '#' + seg.map(v => pad(Math.round((v + m) * 255).toString(16))).join('');
}
const hm2min = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
const min2hm = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/* ---------------------------------------------------------- 状态 */
let STORE = storeKey();   /* 访客是 agenda.v1；登录后按账号分区，登录 / 退出时由 sync.js 切换 */
const PIGMENTS = ['#B23A22', '#2E5E7E', '#4F7A4A', '#C08A1E', '#6A5480', '#8A5A3B', '#2F7E86', '#4C473C'];
const DEFAULT_TAGS = [
  { id: 'tg-work',  name: '工作', color: '#B23A22' },
  { id: 'tg-study', name: '学习', color: '#2E5E7E' },
  { id: 'tg-life',  name: '生活', color: '#4F7A4A' },
  { id: 'tg-move',  name: '运动', color: '#C08A1E' },
  { id: 'tg-rest',  name: '休息', color: '#6A5480' },
];

function blank() {
  return { tasks: [], blocks: [], slots: [], tags: DEFAULT_TAGS.map(t => ({ ...t })), log: [], ui: { date: todayKey(), zoom: 1 } };
}
/** 把读进来的 JSON（本地存档 / 备份文件 / 云端）补齐成完整的 state 形状 */
function normState(p) {
  const s = Object.assign(blank(), p);
  s.ui = Object.assign({ date: todayKey(), zoom: 1 }, p.ui || {});
  if (!s.tags?.length) s.tags = DEFAULT_TAGS.map(t => ({ ...t }));
  s.ui.date = todayKey();
  return s;
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return normState(JSON.parse(raw));
  } catch (e) { console.warn('读取本地数据失败，已重置', e); }
  return blank();
}
let state = loadState();
resetSigs();

const writeLocal = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { toast('保存失败：浏览器存储空间不足'); } };
/* 给改过的记录盖修改时间 → 写本地 → 有数据改动就排一次云同步（未登录时是空操作） */
const save = () => { const changed = stampChanges(); writeLocal(); if (changed) cloudDirty(); };

/* 撤销 */
const undoStack = [];
const snapshot = () => { undoStack.push(JSON.stringify(state)); if (undoStack.length > 40) undoStack.shift(); };
function undo() {
  const s = undoStack.pop();
  if (!s) return toast('没有可撤销的操作');
  state = JSON.parse(s);
  save(); renderAll(); toast('已撤销');
}

/* ---------------------------------------------------------- 派生 */
const taskById  = id => state.tasks.find(t => t.id === id);
const tagById   = id => state.tags.find(t => t.id === id) || { id: null, name: '未分类', color: '#837B6B' };
const childrenOf = id => state.tasks.filter(t => t.parentId === id);
const isParent  = t => childrenOf(t.id).length > 0;
const taskMins  = t => isParent(t) ? childrenOf(t.id).reduce((s, c) => s + c.minutes, 0) : t.minutes;
const blockOf   = taskId => state.blocks.find(b => b.taskId === taskId);
const slotsFor  = dk => state.slots.filter(s => s.date === dk).sort((a, b) => a.start - b.start);
const blocksFor = dk => state.blocks.filter(b => b.date === dk).sort((a, b) => a.start - b.start);
const leaves    = () => state.tasks.filter(t => !isParent(t));
const pending   = () => leaves().filter(t => !blockOf(t.id));

/* 截止时间：t.due = {date, min}，min 是当天的分钟数，1440＝那天之内都行；不设就没有 due。
   子任务同时受父任务的截止约束，取较早的那个 */
const dueBefore = (a, b) => a.date < b.date || (a.date === b.date && a.min < b.min);
function dueOf(t) {
  const own = t.due || null, par = (t.parentId && taskById(t.parentId)?.due) || null;
  if (!own || !par) return own || par;
  return dueBefore(par, own) ? par : own;
}
/** dk 这天任务最晚能排到几点结束：没有截止＝1440，截止日之后＝-1（哪儿都放不下） */
function dueCap(t, dk) {
  const d = t && dueOf(t);
  if (!d || dk < d.date) return 1440;
  return dk === d.date ? d.min : -1;
}
/** 截止时间已经过了 */
const dueGone = t => {
  const d = dueOf(t); if (!d) return false;
  const tk = todayKey();
  return d.date < tk || (d.date === tk && d.min <= nowMin());
};
function fmtDue(d) {
  const tk = todayKey();
  const day = d.date === tk ? '今天' : d.date === shiftKey(tk, 1) ? '明天' : shortDate(d.date);
  return d.min >= 1440 ? day : `${day} ${fmtT(d.min)}`;
}
/** 从一对日期 / 时刻输入框读出截止时间；日期空着＝不设，时刻空着＝当天之内 */
const readDue = (dEl, tEl) => dEl.value ? { date: dEl.value, min: tEl.value ? hm2min(tEl.value) : 1440 } : null;
const writeDue = (d, dEl, tEl) => { dEl.value = d ? d.date : ''; tEl.value = d && d.min < 1440 ? min2hm(d.min) : ''; };

function freeIntervals(dk, ignoreId, base) {
  let iv = base || slotsFor(dk).map(s => ({ s: s.start, e: s.end }));
  for (const b of blocksFor(dk)) {
    if (b.id === ignoreId) continue;
    const out = [];
    for (const x of iv) {
      if (b.end <= x.s || b.start >= x.e) { out.push(x); continue; }
      if (b.start > x.s) out.push({ s: x.s, e: b.start });
      if (b.end < x.e) out.push({ s: b.end, e: x.e });
    }
    iv = out;
  }
  return iv.sort((a, b) => a.s - b.s);
}
/** 找到离 desired 最近的合法起点；floor 之前的时间不考虑，结束不晚于 ceil（截止时间，见 dueCap）；放不下返回 null */
function findPlacement(dk, dur, desired, ignoreId, anywhere, floor, ceil = 1440) {
  const base = anywhere ? [{ s: 0, e: 1440 }] : null;
  let best = null;
  for (const iv of freeIntervals(dk, ignoreId, base)) {
    const lo = Math.max(iv.s, floor || 0), hi = Math.min(iv.e, ceil);
    if (hi - lo < dur) continue;
    const s = clamp(desired, lo, hi - dur);
    const d = Math.abs(s - desired);
    if (!best || d < best.d) best = { start: s, d };
  }
  return best ? best.start : null;
}
/** 今天的话，自动排程不往过去塞 */
const floorOf = dk => dk === todayKey() ? Math.ceil(nowMin() / SNAP) * SNAP : 0;

/* 可用时间段：加入并合并 */
function addSlot(dk, s, e) {
  s = clamp(snap(s), 0, 1440); e = clamp(snap(e), 0, 1440);
  if (e - s < SNAP) return false;
  state.slots.push({ id: uid(), date: dk, start: s, end: e });
  mergeSlots(dk);
  return true;
}
function mergeSlots(dk) {
  const mine = slotsFor(dk);
  const rest = state.slots.filter(x => x.date !== dk);
  const out = [];
  for (const s of mine) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ id: s.id, date: dk, start: s.start, end: s.end });
  }
  state.slots = rest.concat(out);
}

/* ---------------------------------------------------------- 视图几何 */
const ZOOM = [1.05, 1.6, 2.4];
let VIEW = { lo: 420, hi: 1320, ppm: 1.6 };
function computeView(dk) {
  let lo = 8 * 60, hi = 22 * 60;
  for (const s of slotsFor(dk)) { lo = Math.min(lo, s.start); hi = Math.max(hi, s.end); }
  for (const b of blocksFor(dk)) { lo = Math.min(lo, b.start); hi = Math.max(hi, b.end); }
  if (dk === todayKey()) { const n = nowMin(); lo = Math.min(lo, n); hi = Math.max(hi, n); }
  lo = clamp(Math.floor(lo / 60) * 60 - 60, 0, 1260);
  hi = clamp(Math.ceil(hi / 60) * 60 + 60, lo + 180, 1440);
  VIEW = { lo, hi, ppm: ZOOM[state.ui.zoom] ?? 1.6 };
}
const y2m = y => VIEW.lo + y / VIEW.ppm;
const m2y = m => (m - VIEW.lo) * VIEW.ppm;

/* 磁吸：靠近时间段边界 / 其他色块边界时精确对齐 */
function magnet(dk, m, ignoreId) {
  const TOL = 9;
  let best = snap(m), bd = Math.abs(snap(m) - m) + .001;
  const marks = [];
  for (const s of slotsFor(dk)) marks.push(s.start, s.end);
  for (const b of blocksFor(dk)) { if (b.id !== ignoreId) marks.push(b.start, b.end); }
  for (const k of marks) { const d = Math.abs(k - m); if (d < TOL && d < bd) { best = k; bd = d; } }
  return best;
}

/* ---------------------------------------------------------- 提示 */
function toast(msg, action) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { action.fn(); close(); };
    el.appendChild(b);
  }
  $('#toastWrap').appendChild(el);
  let done = false;
  const close = () => { if (done) return; done = true; el.classList.add('out'); setTimeout(() => el.remove(), 240); };
  setTimeout(close, action ? 7000 : 2800);
}

/* ---------------------------------------------------------- 主题
   深浅两套皮：跟随系统 → 浅色 → 深色 循环。
   外观属于这台机器，单独存一个键，不进 state，导入备份不会把它带回来。
   首帧的 data-theme 由 index.html 头部那段小脚本先落定，这里只接手后续切换。 */
const THEME_KEY = 'agenda.theme.v1';
const THEME_MODES = ['auto', 'light', 'dark'];
const THEME_LABEL = { auto: '随系统', light: '浅色', dark: '深色' };
const sysDark = window.matchMedia
  ? matchMedia('(prefers-color-scheme: dark)')
  : { matches: false, addEventListener() { } };
let themeMode = 'auto';
try { const m = localStorage.getItem(THEME_KEY); if (THEME_MODES.includes(m)) themeMode = m; } catch (e) { }

const isDark = () => themeMode === 'dark' || (themeMode === 'auto' && sysDark.matches);
/** 标签颜料按深浅取用；--c 用于线和圆点，--c-rgb 供 rgba() 调淡底色 */
const cvars = hex => { const c = isDark() ? lighten(hex) : hex; return `--c:${c};--c-rgb:${hexRgb(c)}`; };

function applyTheme(rerender) {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const b = $('#btnTheme');
  b.textContent = THEME_LABEL[themeMode];
  b.title = themeMode === 'auto'
    ? `外观：跟随系统（当前${dark ? '深色' : '浅色'}） · 点击切换`
    : `外观：${THEME_LABEL[themeMode]} · 点击切换`;
  if (rerender) renderAll();   /* 颜料要按深浅重算一遍 */
}
function cycleTheme() {
  themeMode = THEME_MODES[(THEME_MODES.indexOf(themeMode) + 1) % THEME_MODES.length];
  try { localStorage.setItem(THEME_KEY, themeMode); } catch (e) { }
  applyTheme(true);
}
sysDark.addEventListener('change', () => { if (themeMode === 'auto') applyTheme(true); });
/* 兜底：标签页在后台时那次 change 有可能收不到，回到前台再对一次表 */
const syncTheme = () => {
  if (document.documentElement.dataset.theme !== (isDark() ? 'dark' : 'light')) applyTheme(true);
};
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncTheme(); });
window.addEventListener('focus', syncTheme);

/* ============================================================
   渲染
   ============================================================ */
function renderAll() {
  renderHeader(); renderPool(); renderLog(); renderAvail(); renderTimeline(); renderStats(); renderBadge();
}

function renderHeader() {
  $('#todayDate').textContent = cnDate(todayKey());
  $('#viewDate').textContent = cnDate(state.ui.date) + (state.ui.date === todayKey() ? ' · 今天' : '');
  $('#viewDateShort').textContent = midDate(state.ui.date);   /* 手机上用这个短的，「今天」由按钮亮起来表示 */
  $('#btnToday').classList.toggle('on', state.ui.date === todayKey());
  $('#datePick').value = state.ui.date;
  $$('#zoom button').forEach(b => b.classList.toggle('on', +b.dataset.z === state.ui.zoom));
}
function tickClock() {
  const d = new Date();
  $('#todayClock').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  if (todayKey() !== BOOT_DAY) location.reload();
}

/* ---------------------------------------------------------- 待办池 */
function taskRow(t, sub) {
  const tag = tagById(t.tagId);
  const blk = blockOf(t.id);
  const cls = ['task']; if (sub) cls.push('sub'); if (blk) cls.push('placed');
  const when = blk ? `${blk.date === state.ui.date ? '' : shortDate(blk.date) + ' '}${fmtT(blk.start)}` : '';
  const due = t.due ? dueTag(t.due, !blk && dueGone(t)) : '';
  return `<div class="${cls.join(' ')}" data-id="${t.id}" style="${cvars(tag.color)}">
    ${blk ? '<span class="grip" style="opacity:.4">✓</span>' : '<span class="grip">⠿</span>'}
    <div class="t-main">
      <div class="t-title">${esc(t.title)}</div>
      <div class="t-meta">
        <span class="m-dur">${fmtD(t.minutes)}</span>
        <span class="m-tag"><i></i>${esc(tag.name)}</span>
        ${due}
        ${blk ? `<span class="m-dur" style="color:var(--cinnabar)">已排 ${when}</span>` : ''}
      </div>
    </div>
    <div class="t-acts">
      ${blk
      ? `<button data-act="unplace" title="移出日程">↩</button>`
      : `<button data-act="place" title="排入日程">↳</button>`}
      <button data-act="edit" title="编辑 / 拆分">✎</button>
      <button data-act="done" title="标记完成（删除）">✓</button>
    </div>
  </div>`;
}

/** 待办里的截止角标；过了截止还没排上的标朱砂 */
const dueTag = (d, late) =>
  `<span class="m-due${late ? ' late' : ''}" title="${late ? '已过截止时间，改一下截止再排' : '排程不会越过这个时间'}">${late ? '已逾期 · ' : '截止 '}${fmtDue(d)}</span>`;

function renderPool() {
  const box = $('#pool');
  const tops = state.tasks.filter(t => !t.parentId);
  if (!tops.length) {
    box.innerHTML = `<div class="empty"><b>还没有任务</b>在上面写下第一件要做的事</div>`;
  } else {
    box.innerHTML = tops.map(p => {
      const kids = childrenOf(p.id);
      if (!kids.length) return taskRow(p, false);
      const total = taskMins(p);
      const doneN = kids.filter(k => blockOf(k.id)).length;
      const closed = collapsed.has(p.id) ? ' closed' : '';
      const late = p.due && dueGone(p) && kids.some(k => !blockOf(k.id));
      return `<div class="group${closed}" data-gid="${p.id}">
        <div class="group-head">
          <span class="caret">▼</span>
          <span class="g-title">${esc(p.title)}</span>
          <span class="g-meta">${fmtD(total)} · 已排 ${doneN}/${kids.length}</span>
          ${p.due ? dueTag(p.due, late) : ''}
          <div class="t-acts" style="opacity:1">
            <button data-act="edit" data-id="${p.id}" title="编辑 / 拆分">✎</button>
            <button data-act="del" data-id="${p.id}" title="删除整组">×</button>
          </div>
        </div>
        <div class="group-kids">${kids.map(k => taskRow(k, true)).join('')}</div>
      </div>`;
    }).join('');
  }
  $('#poolCount').textContent = pending().length;
  $('#tabPoolN').textContent = pending().length || '';
}
const collapsed = new Set();

function renderLog() {
  const items = state.log.filter(l => l.date === state.ui.date).slice().reverse();
  $('#doneCount').textContent = items.length;
  $('#doneList').innerHTML = items.length
    ? items.map(l => `<div class="doneitem"><span class="dmark">✓</span><span class="dt">${esc(l.title)}</span><span class="dm">${fmtD(l.minutes)}</span></div>`).join('')
    : `<div class="empty" style="padding:9px">今天还没有完成的任务</div>`;
}

/* ---------------------------------------------------------- 可用时间 */
function renderAvail() {
  const ss = slotsFor(state.ui.date);
  $('#slotChips').innerHTML = ss.length
    ? ss.map(s => `<span class="slotchip" data-id="${s.id}">${fmtT(s.start)}–${fmtT(s.end)}<b>${fmtD(s.end - s.start)}</b><button data-act="delslot" title="删除">×</button></span>`).join('')
    : `<span class="ab-none">尚未选取任何可用时间</span>`;
}

/* ---------------------------------------------------------- 统计 */
function renderStats() {
  const dk = state.ui.date;
  const avail = slotsFor(dk).reduce((s, x) => s + (x.end - x.start), 0);
  const used = blocksFor(dk).reduce((s, x) => s + (x.end - x.start), 0);
  const pend = pending();
  const pmin = pend.reduce((s, t) => s + t.minutes, 0);
  const ratio = avail ? Math.min(100, used / avail * 100) : 0;
  $('#stats').innerHTML = `
    <div class="stat"><div class="s-lab">可用</div><div class="s-val">${avail ? fmtDH(avail) : '—'}</div></div>
    <div class="stat fill"><div class="s-lab">已排</div><div class="s-val">${used ? fmtDH(used) : '—'}</div><div class="s-bar" style="width:${ratio}%"></div></div>
    <div class="stat"><div class="s-lab">尚余</div><div class="s-val">${avail - used > 0 ? fmtDH(avail - used) : '—'}</div></div>
    <div class="stat"><div class="s-lab">待办</div><div class="s-val">${pend.length}<small>项</small>${pmin ? `<span class="s-extra"> ${fmtDH(pmin)}</span>` : ''}</div></div>`;
}

function renderBadge() {
  const n = overdue().length;
  for (const b of [$('#reviewBadge'), $('#tabBadge')]) { b.hidden = !n; b.textContent = n; }
}
function overdue() {
  const tk = todayKey(), n = nowMin();
  return state.blocks
    .filter(b => b.date < tk || (b.date === tk && b.end <= n))
    .sort((a, b) => a.date === b.date ? a.start - b.start : (a.date < b.date ? -1 : 1));
}

/* ---------------------------------------------------------- 时间轴 */
function renderTimeline() {
  const tl = $('#timeline'), keep = tl.scrollTop;
  const dk = state.ui.date;
  computeView(dk);
  const H = (VIEW.hi - VIEW.lo) * VIEW.ppm;
  $('#surface').style.height = H + 'px';   /* 高度给 surface，命中测试才准 */

  /* 左侧刻度 */
  let g = '';
  for (let m = Math.ceil(VIEW.lo / 30) * 30; m <= VIEW.hi; m += 30) {
    const major = m % 60 === 0;
    if (!major && VIEW.ppm < 1.5) continue;
    g += `<div class="hourlab${major ? ' major' : ''}" style="top:${m2y(m)}px">${major ? fmtT(m) : ':30'}</div>`;
  }
  $('#gutter').innerHTML = g;

  /* 画布 */
  let s = '';
  for (let m = Math.ceil(VIEW.lo / 30) * 30; m <= VIEW.hi; m += 30) {
    s += `<div class="hourline${m % 60 === 0 ? ' major' : ''}" style="top:${m2y(m)}px"></div>`;
  }
  for (const sl of slotsFor(dk)) {
    s += `<div class="slot" data-id="${sl.id}" data-label="${fmtD(sl.end - sl.start)}"
      style="top:${m2y(sl.start)}px;height:${(sl.end - sl.start) * VIEW.ppm}px">
      <button class="slot-x" data-act="delslot" title="删除该时间段">×</button>
      <div class="slot-h t" data-edge="t"></div><div class="slot-h b" data-edge="b"></div></div>`;
  }
  const now = nowMin(), isToday = dk === todayKey();
  for (const b of blocksFor(dk)) {
    const t = taskById(b.taskId);
    if (!t) continue;
    const tag = tagById(t.tagId);
    const parent = t.parentId ? taskById(t.parentId) : null;
    const h = (b.end - b.start) * VIEW.ppm;
    const past = b.date < todayKey() || (isToday && b.end <= now);
    const cls = ['block'];
    if (h < 46) cls.push('short');
    if (h < 26) cls.push('tiny');
    if (past) cls.push('past', 'overdue');
    s += `<div class="${cls.join(' ')}" data-id="${b.id}"
      style="top:${m2y(b.start)}px;height:${Math.max(h, 20)}px;${cvars(tag.color)}">
      <div class="b-time">${fmtT(b.start)}–${fmtT(b.end)}<span style="color:var(--ink-4)"> · ${fmtD(b.end - b.start)}</span></div>
      <div class="b-title">${esc(t.title)}</div>
      ${parent ? `<div class="b-kicker">${esc(parent.title)} · ${esc(tag.name)}</div>` : ''}
      <div class="b-acts">
        <button data-act="done" title="完成（删除任务）">✓</button>
        <button data-act="back" title="未完成，退回待办">↩</button>
        <button data-act="edit" title="编辑">✎</button>
      </div></div>`;
  }
  if (isToday && now >= VIEW.lo && now <= VIEW.hi) {
    s += `<div class="nowline" style="top:${m2y(now)}px"><span class="nowtag">${fmtT(now)}</span></div>`;
  }
  $('#surface').innerHTML = s;

  /* 空白日提示：sticky 贴在可视区中部，滚到哪都看得见 */
  let em = $('#tlEmpty');
  if (!slotsFor(dk).length && !blocksFor(dk).length) {
    if (!em) {
      em = document.createElement('div');
      em.id = 'tlEmpty'; em.className = 'tl-empty';
      $('#tlInner').insertBefore(em, $('#surface'));
    }
    em.innerHTML = isPhone()                       /* 触屏上刷时间段让给了滚动 */
      ? `<b>这一天还是空白的</b>先点「＋ 时间段」选取可用时间<br>或「沿用昨日」照搬前一天`
      : `<b>这一天还是空白的</b>先点「＋ 时间段」选取可用时间<br>或直接在时间轴上按住鼠标上下拖动`;
    em.hidden = false;
  } else if (em) em.hidden = true;

  tl.scrollTop = keep;
}
function updateNowLine() {
  const el = $('.nowline');
  if (!el) { if (state.ui.date === todayKey()) renderTimeline(); return; }
  const n = nowMin();
  el.style.top = m2y(n) + 'px';
  el.querySelector('.nowtag').textContent = fmtT(n);
}
function scrollToNow(smooth) {
  const tl = $('#timeline');
  const target = state.ui.date === todayKey() ? nowMin() : (slotsFor(state.ui.date)[0]?.start ?? VIEW.lo);
  tl.scrollTo({ top: Math.max(0, m2y(target) - tl.clientHeight * .35), behavior: smooth ? 'smooth' : 'auto' });
}
function flashBlock(id) {
  const el = $(`.block[data-id="${id}"]`);
  if (!el) return;
  el.classList.add('flash');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setTimeout(() => el.classList.remove('flash'), 1500);
}

/* ============================================================
   标签选择器
   ============================================================ */
function renderTagPicker(el, selected, onPick) {
  const draw = () => {
    el.innerHTML = state.tags.map(t =>
      `<button type="button" class="tagchip${t.id === selected ? ' on' : ''}" data-id="${t.id}"
        style="${cvars(t.color)}"><i></i>${esc(t.name)}</button>`).join('')
      + `<button type="button" class="tagchip add" data-add="1">＋ 标签</button>`;
  };
  draw();
  el.onclick = e => {
    const add = e.target.closest('[data-add]');
    if (add) return openNewTag(el, id => { selected = id; onPick(id); draw(); });
    const c = e.target.closest('.tagchip[data-id]');
    if (!c) return;
    selected = c.dataset.id; onPick(selected); draw();
  };
}
function openNewTag(el, cb) {
  if (el.querySelector('.tag-new')) return;
  let color = PIGMENTS[state.tags.length % PIGMENTS.length];
  const box = document.createElement('div');
  box.className = 'tag-new';
  box.innerHTML = `<input type="text" placeholder="新标签名" maxlength="8">
    <div class="tag-swatches">${PIGMENTS.map(c => `<i data-c="${c}" class="${c === color ? 'on' : ''}" style="${cvars(c)}"></i>`).join('')}</div>
    <button type="button" class="primary-btn small">建立</button>`;
  el.appendChild(box);
  const inp = box.querySelector('input'); inp.focus();
  box.querySelector('.tag-swatches').onclick = e => {
    const i = e.target.closest('i'); if (!i) return;
    color = i.dataset.c;
    $$('i', box).forEach(x => x.classList.toggle('on', x === i));
  };
  const commit = () => {
    const name = inp.value.trim();
    if (!name) { inp.focus(); return; }
    const t = { id: uid(), name, color };
    state.tags.push(t); save(); cb(t.id);
  };
  box.querySelector('button.primary-btn').onclick = commit;
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } };
}

/* ============================================================
   新建任务
   ============================================================ */
let newTag = DEFAULT_TAGS[0].id;
/** state 被整体换掉（切账号、云端合并）后，新建框选中的标签可能已不存在 */
function resetNewTag() {
  if (!state.tags.some(t => t.id === newTag)) newTag = state.tags[0].id;
  renderTagPicker($('#newTags'), newTag, id => newTag = id);
}
resetNewTag();

$('#newQuick').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  const m = +b.dataset.min;
  $('#newH').value = Math.floor(m / 60); $('#newM').value = m % 60;
};
/* 截止时间（可选）：平时收着，点「＋ 截止时间」才展开 */
function openNewDue(open) {
  $('#newDueTog').hidden = open;
  $('#newDueFields').hidden = !open;
  if (open) { if (!$('#newDueD').value) $('#newDueD').value = state.ui.date; }
  else { $('#newDueD').value = ''; $('#newDueT').value = ''; }
}
$('#newDueTog').onclick = () => { openNewDue(true); $('#newDueT').focus(); };
$('#newDueX').onclick = () => openNewDue(false);

function addTask() {
  const title = $('#newTitle').value.trim();
  if (!title) { $('#newTitle').focus(); return toast('先写个任务名'); }
  const mins = (+$('#newH').value || 0) * 60 + (+$('#newM').value || 0);
  if (mins < 1) return toast('耗时至少 1 分钟');
  if (!$('#newDueD').value && $('#newDueT').value) return toast('截止时间要先选日期');
  const due = readDue($('#newDueD'), $('#newDueT'));
  snapshot();
  const t = { id: uid(), title, minutes: mins, tagId: newTag, note: '', parentId: null, createdAt: Date.now() };
  if (due) t.due = due;
  state.tasks.push(t);
  save();
  $('#newTitle').value = '';
  openNewDue(false);
  renderPool(); renderStats();
  $('#newTitle').focus();
}
$('#btnAdd').onclick = addTask;
$('#newTitle').onkeydown = e => { if (e.key === 'Enter') addTask(); };

/* ============================================================
   编辑 / 拆分
   ============================================================ */
const dlg = $('#taskDialog');
let editId = null, subDraft = [], fTag = null;

function openTask(id) {
  const t = taskById(id); if (!t) return;
  editId = id; fTag = t.tagId;
  $('#dlgTitle').textContent = t.parentId ? '编辑子任务' : '编辑任务';
  $('#fTitle').value = t.title;
  $('#fH').value = Math.floor(t.minutes / 60);
  $('#fM').value = t.minutes % 60;
  $('#fNote').value = t.note || '';
  writeDue(t.due, $('#fDueD'), $('#fDueT'));
  const par = t.parentId ? taskById(t.parentId) : null;
  $('#fDueHint').textContent = par?.due
    ? `父任务「${par.title}」截止 ${fmtDue(par.due)}，两者以较早的为准。`
    : t.parentId ? '可留空；只填日期＝当天之内。排程不会越过截止时间。'
      : '可留空；只填日期＝当天之内。排程不会越过截止时间，子任务也一样。';
  renderTagPicker($('#fTags'), fTag, v => fTag = v);
  subDraft = childrenOf(id).map(c => ({ id: c.id, title: c.title, minutes: c.minutes, tagId: c.tagId }));
  $('#splitSection').hidden = !!t.parentId;
  renderSplit();
  dlg.showModal();
  if (!isPhone()) { $('#fTitle').focus(); $('#fTitle').select(); }   /* 手机上一打开就弹键盘太挡事 */
}
function renderSplit() {
  const list = $('#splitList');
  list.innerHTML = subDraft.map((s, i) => `<div class="subrow" data-i="${i}">
    <span class="s-n">${i + 1}</span>
    <input class="s-t txt" type="text" value="${esc(s.title)}" placeholder="子任务名称">
    <input class="s-m" type="number" min="1" max="1440" step="1" value="${s.minutes}"><span class="s-u">分</span>
    <select class="s-g">${state.tags.map(t => `<option value="${t.id}"${t.id === s.tagId ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
    <button type="button" class="s-x" title="删除">×</button>
  </div>`).join('');
  const sum = subDraft.reduce((a, s) => a + (+s.minutes || 0), 0);
  const target = (+$('#fH').value || 0) * 60 + (+$('#fM').value || 0);
  const el = $('#splitSum');
  if (!subDraft.length) el.innerHTML = '尚未拆分';
  else {
    const diff = target - sum;
    el.innerHTML = `合计 ${fmtD(sum)} / 计划 ${fmtD(target)} · ` +
      (diff === 0 ? '<span class="ok">刚好</span>'
        : diff > 0 ? `剩余 ${fmtD(diff)}`
          : `<span class="over">超出 ${fmtD(-diff)}</span>`);
  }
}
$('#splitList').addEventListener('input', e => {
  const row = e.target.closest('.subrow'); if (!row) return;
  const i = +row.dataset.i;
  if (e.target.classList.contains('s-t')) subDraft[i].title = e.target.value;
  if (e.target.classList.contains('s-m')) { subDraft[i].minutes = clamp(+e.target.value || 0, 0, 1440); renderSplitSum(); }
  if (e.target.classList.contains('s-g')) subDraft[i].tagId = e.target.value;
});
$('#splitList').addEventListener('click', e => {
  if (!e.target.classList.contains('s-x')) return;
  subDraft.splice(+e.target.closest('.subrow').dataset.i, 1);
  renderSplit();
});
function renderSplitSum() {
  const sum = subDraft.reduce((a, s) => a + (+s.minutes || 0), 0);
  const target = (+$('#fH').value || 0) * 60 + (+$('#fM').value || 0);
  const diff = target - sum;
  $('#splitSum').innerHTML = subDraft.length
    ? `合计 ${fmtD(sum)} / 计划 ${fmtD(target)} · ` + (diff === 0 ? '<span class="ok">刚好</span>' : diff > 0 ? `剩余 ${fmtD(diff)}` : `<span class="over">超出 ${fmtD(-diff)}</span>`)
    : '尚未拆分';
}
$('#fH').oninput = $('#fM').oninput = renderSplitSum;
$('#fDueX').onclick = () => writeDue(null, $('#fDueD'), $('#fDueT'));
$('#addSub').onclick = () => {
  const target = (+$('#fH').value || 0) * 60 + (+$('#fM').value || 0);
  const used = subDraft.reduce((a, s) => a + (+s.minutes || 0), 0);
  const rest = Math.max(5, Math.min(target - used, target || 30));
  subDraft.push({ title: '', minutes: rest > 0 ? rest : 30, tagId: fTag });
  renderSplit();
  const rows = $$('.subrow .s-t'); rows[rows.length - 1]?.focus();
};
$('#fQuick').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  const m = +b.dataset.min;
  $('#fH').value = Math.floor(m / 60); $('#fM').value = m % 60;
  renderSplitSum();
};
$('#btnCancel').onclick = () => dlg.close();
$('#btnDelTask').onclick = () => { const id = editId; dlg.close(); removeTask(id, false); };

$('#taskForm').addEventListener('submit', e => {
  e.preventDefault();
  const t = taskById(editId); if (!t) return dlg.close();
  const title = $('#fTitle').value.trim();
  if (!title) { $('#fTitle').focus(); return toast('任务名不能为空'); }
  const mins = (+$('#fH').value || 0) * 60 + (+$('#fM').value || 0);
  if (mins < 1 && !subDraft.length) return toast('耗时至少 1 分钟');
  const bad = subDraft.find(s => !s.title.trim() || (+s.minutes || 0) < 1);
  if (bad) return toast('子任务需要名称和大于 0 的耗时');
  if (!$('#fDueD').value && $('#fDueT').value) return toast('截止时间要先选日期');

  snapshot();
  t.title = title; t.tagId = fTag; t.note = $('#fNote').value.trim();
  t.minutes = Math.max(mins, 1);
  const due = readDue($('#fDueD'), $('#fDueT'));
  if (due) t.due = due; else delete t.due;   /* 先定截止，下面的 revalidate 才按新的来 */

  /* 同步子任务 */
  const keep = new Set(subDraft.filter(s => s.id).map(s => s.id));
  for (const c of childrenOf(t.id)) if (!keep.has(c.id)) purgeTask(c.id);
  subDraft.forEach(s => {
    if (s.id) {
      const c = taskById(s.id);
      if (c) { c.title = s.title.trim(); c.minutes = +s.minutes; c.tagId = s.tagId; revalidate(c.id); }
    } else {
      state.tasks.push({ id: uid(), title: s.title.trim(), minutes: +s.minutes, tagId: s.tagId, note: '', parentId: t.id, createdAt: Date.now() });
    }
  });
  /* 有子任务的父任务不能单独排程 */
  if (childrenOf(t.id).length && blockOf(t.id)) {
    state.blocks = state.blocks.filter(b => b.taskId !== t.id);
    toast('父任务已拆分，原日程已撤下，请分别安排子任务');
  }
  revalidate(t.id);
  save(); renderAll(); dlg.close();
});
dlg.addEventListener('close', () => { editId = null; subDraft = []; });

/** 时长或截止时间变化后重新校验已排日程：尽量就近挪一挪，挪不动就退回待办 */
function revalidate(taskId) {
  const b = blockOf(taskId); if (!b) return;
  const t = taskById(taskId); if (!t) return;
  const d = taskMins(t), cap = dueCap(t, b.date);
  if (b.end - b.start === d && b.end <= cap) return;
  const s = findPlacement(b.date, d, b.start, b.id, false, 0, cap);
  if (s === null) {
    state.blocks = state.blocks.filter(x => x.id !== b.id);
    toast(b.end - b.start !== d
      ? `「${t.title}」时长变更后放不下，已退回待办`
      : `「${t.title}」在截止时间之前放不下，已退回待办`);
  } else { b.start = s; b.end = s + d; }
}

/* ============================================================
   任务动作
   ============================================================ */
function purgeTask(id) {                       /* 静默删除（含子任务与日程） */
  const ids = [id, ...childrenOf(id).map(c => c.id)];
  state.tasks = state.tasks.filter(t => !ids.includes(t.id));
  state.blocks = state.blocks.filter(b => !ids.includes(b.taskId));
}
function removeTask(id, complete) {
  const t = taskById(id); if (!t) return;
  snapshot();
  if (complete) {
    const targets = isParent(t) ? childrenOf(t.id) : [t];
    for (const x of targets) {
      const b = blockOf(x.id);
      state.log.push({ id: uid(), title: x.title, minutes: x.minutes, tagId: x.tagId, date: b ? b.date : todayKey(), at: Date.now() });
    }
  }
  purgeTask(id);
  /* 完成最后一个子任务时，父任务一并结清（不再记一笔日志，否则时长会重复计入） */
  const par = complete && t.parentId ? taskById(t.parentId) : null;
  const closed = par && childrenOf(par.id).length === 0 ? par : null;
  if (closed) purgeTask(closed.id);
  save(); renderAll();
  toast(complete
    ? (closed ? `已完成「${t.title}」，「${closed.title}」也一并结清` : `已完成「${t.title}」`)
    : `已删除「${t.title}」`, { label: '撤销', fn: undo });
}
function unplace(taskId, silent) {
  const b = blockOf(taskId); if (!b) return;
  if (!silent) snapshot();
  state.blocks = state.blocks.filter(x => x.id !== b.id);
  save(); renderAll();
  if (!silent) toast('已退回待办，等你重新安排', { label: '撤销', fn: undo });
}
function place(taskId, dk = state.ui.date, quiet) {
  const t = taskById(taskId); if (!t || isParent(t)) return false;
  if (blockOf(taskId)) return false;
  const d = taskMins(t);
  const floor = floorOf(dk), cap = dueCap(t, dk);
  const s = findPlacement(dk, d, floor, null, false, floor, cap);
  if (s === null) {
    if (quiet) return false;
    if (cap - floor < d) toast(`「${t.title}」截止于 ${fmtDue(dueOf(t))}，${shortDate(dk)} 已经来不及排了`);
    else toast(`${shortDate(dk)}${cap < 1440 ? ' 截止前' : ''}可用时间不足，放不下 ${fmtD(d)}`, { label: '添加时间段', fn: () => $('#btnAddSlot').click() });
    return false;
  }
  if (!quiet) snapshot();
  const b = { id: uid(), taskId, date: dk, start: s, end: s + d };
  state.blocks.push(b);
  if (!quiet) { save(); renderAll(); flashBlock(b.id); }
  return true;
}

/* 待办池事件 */
$('#pool').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (btn) {
    const id = btn.dataset.id || e.target.closest('.task')?.dataset.id;
    if (!id) return;
    e.stopPropagation();
    const act = btn.dataset.act;
    if (act === 'place' && place(id) && isPhone()) showPlaced(id);
    if (act === 'unplace') unplace(id);
    if (act === 'edit') openTask(id);
    if (act === 'done') removeTask(id, true);
    if (act === 'del') removeTask(id, false);
    return;
  }
  const head = e.target.closest('.group-head');
  if (head) {
    const gid = head.parentElement.dataset.gid;
    collapsed.has(gid) ? collapsed.delete(gid) : collapsed.add(gid);
    head.parentElement.classList.toggle('closed');
  }
});
$('#pool').addEventListener('dblclick', e => {
  const el = e.target.closest('.task'); if (el) openTask(el.dataset.id);
});

$('#btnAutoAll').onclick = () => {
  /* 有截止的先排、截止早的更先（sort 是稳定的，其余照原顺序） */
  const list = pending().map(t => [t, dueOf(t)])
    .sort(([, a], [, b]) => !a || !b ? (!a) - (!b) : dueBefore(a, b) ? -1 : dueBefore(b, a) ? 1 : 0)
    .map(([t]) => t);
  if (!list.length) return toast('待办已经空了');
  snapshot();
  let ok = 0;
  for (const t of list) if (place(t.id, state.ui.date, true)) ok++;
  save(); renderAll();
  if (ok && isPhone()) setView('sched');
  toast(ok ? `已排入 ${ok} 项${ok < list.length ? `，${list.length - ok} 项没排下` : ''}` : '可用时间不够，一项都没排下',
    ok ? { label: '撤销', fn: undo } : { label: '添加时间段', fn: () => $('#btnAddSlot').click() });
};
$('#btnClearLog').onclick = () => {
  if (!state.log.length) return toast('没有完成记录');
  snapshot(); state.log = []; save(); renderLog();
  toast('已清空完成记录', { label: '撤销', fn: undo });
};

/* ============================================================
   日期 / 缩放 / 可用时间
   ============================================================ */
$('#prevDay').onclick = () => gotoDate(shiftKey(state.ui.date, -1));
$('#nextDay').onclick = () => gotoDate(shiftKey(state.ui.date, 1));
$('#btnToday').onclick = () => { gotoDate(todayKey()); scrollToNow(true); };
$('#datePick').onchange = e => { if (e.target.value) gotoDate(e.target.value); };
$('#datePick').onclick = e => { try { e.target.showPicker(); } catch (_) { } };
function gotoDate(k) { state.ui.date = k; save(); renderAll(); scrollToNow(false); }
$('#zoom').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  state.ui.zoom = +b.dataset.z; save(); renderHeader(); renderTimeline(); scrollToNow(false);
};

$('#btnAddSlot').onclick = () => {
  const f = $('#slotForm');
  f.hidden = !f.hidden;
  if (!f.hidden) $('#slotStart').focus();
};
$('#slotForm').addEventListener('submit', e => {
  e.preventDefault();
  const s = hm2min($('#slotStart').value), en = hm2min($('#slotEnd').value);
  if (!(en > s)) return toast('结束时间要晚于开始时间');
  snapshot();
  addSlot(state.ui.date, s, en);
  save(); renderAll();
  if (isPhone()) $('#slotForm').hidden = true;   /* 手机上表单占地方，加完就收起 */
});
$('#slotForm').addEventListener('click', e => {
  const b = e.target.closest('button[data-s]'); if (!b) return;
  $('#slotStart').value = b.dataset.s; $('#slotEnd').value = b.dataset.e;
});
$('#btnCopyPrev').onclick = () => {
  const prev = slotsFor(shiftKey(state.ui.date, -1));
  if (!prev.length) return toast('前一天没有设定可用时间');
  snapshot();
  for (const s of prev) addSlot(state.ui.date, s.start, s.end);
  save(); renderAll();
  toast(`已沿用 ${prev.length} 个时间段`, { label: '撤销', fn: undo });
};
$('#slotChips').onclick = e => {
  const b = e.target.closest('button[data-act=delslot]'); if (!b) return;
  delSlot(b.closest('.slotchip').dataset.id);
};
function delSlot(id) {
  const sl = state.slots.find(x => x.id === id); if (!sl) return;
  const inside = state.blocks.filter(b => b.date === sl.date && b.start >= sl.start && b.end <= sl.end);
  snapshot();
  state.slots = state.slots.filter(x => x.id !== id);
  state.blocks = state.blocks.filter(b => !inside.includes(b));
  save(); renderAll();
  toast(inside.length ? `已删除时间段，${inside.length} 项任务退回待办` : '已删除时间段', { label: '撤销', fn: undo });
}

/* ============================================================
   时间轴交互：拖拽排程 / 移动 / 刷时间段 / 拉伸
   ============================================================ */
const surface = $('#surface'), timelineEl = $('#timeline');
let drag = null, dghost = null, preview = null;

/* ---------------------------------------------------------- 手机：两栏收成两页
   断点与 styles.css「手机」区的 max-width 保持一致。桌面上两栏都在，
   body[data-view] 不起作用，底栏也藏着。视图属于这台设备的这一次打开，不进 state。 */
const PHONE = window.matchMedia ? matchMedia('(max-width: 720px)') : { matches: false };
const isPhone = () => PHONE.matches;
let tlKeep = null;   /* 日程页藏起来时时间轴的滚动位置会丢，切回来时还原 */
function setView(v) {
  const cur = document.body.dataset.view;
  if (v === cur) return;
  if (cur === 'sched') tlKeep = timelineEl.scrollTop;
  document.body.dataset.view = v;
  $$('#tabbar button[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  if (v === 'sched') { if (tlKeep === null) scrollToNow(false); else timelineEl.scrollTop = tlKeep; }
}
/** 从待办页排入之后，翻到日程页让人看见落在哪 */
function showPlaced(taskId) {
  setView('sched');
  const b = blockOf(taskId);
  if (b) flashBlock(b.id);
}
$('#tabbar').onclick = e => {
  const b = e.target.closest('button[data-view]'); if (!b) return;
  if (b.dataset.view !== 'add') return setView(b.dataset.view);
  setView('tasks');                                /* ＋：直接去写一件新事 */
  $('.col-tasks').scrollTop = 0;
  $('#newTitle').focus();
};

/* 报头「⋯」菜单：手机上收着不常用的按钮；桌面上 #btnMore 不显示 */
const mastEl = $('#mastActions');
function toggleMenu(open) {
  mastEl.classList.toggle('open', open);
  $('#btnMore').setAttribute('aria-expanded', open);
}
$('#btnMore').onclick = () => toggleMenu(!mastEl.classList.contains('open'));
mastEl.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b && b.id !== 'btnMore' && b.id !== 'btnTheme') toggleMenu(false);   /* 外观可能要连点几下，菜单先留着 */
});
document.addEventListener('pointerdown', e => { if (!e.target.closest('#mastActions')) toggleMenu(false); });

function surfaceY(clientY) {
  const r = surface.getBoundingClientRect();
  return clientY - r.top;
}
function overSurface(e) {
  const r = surface.getBoundingClientRect();
  return e.clientX >= r.left - 60 && e.clientX <= r.right + 20 && e.clientY >= r.top && e.clientY <= r.bottom;
}
function showPreview(top, height, label, kind) {
  if (!preview) { preview = document.createElement('div'); surface.appendChild(preview); }
  preview.className = 'ghost' + (kind ? ' ' + kind : '');
  preview.style.top = top + 'px';
  preview.style.height = Math.max(height, 16) + 'px';
  preview.innerHTML = `<span>${label}</span>`;
}
function killPreview() { preview?.remove(); preview = null; }
/* 拖着有截止时间的任务时，把截止之后的那段时间轴罩上斜纹 */
let dueZone = null;
function showDueZone(task) {
  const cap = dueCap(task, state.ui.date);
  if (cap >= VIEW.hi) return;
  const top = cap < 0 ? 0 : m2y(Math.max(cap, VIEW.lo));
  dueZone = document.createElement('div');
  dueZone.className = 'duezone';
  dueZone.style.top = top + 'px';
  dueZone.style.height = (m2y(VIEW.hi) - top) + 'px';
  dueZone.innerHTML = `<span>${cap < 0 ? '已过截止日期' : '截止 ' + fmtT(cap)}</span>`;
  surface.appendChild(dueZone);
}
function killDueZone() { dueZone?.remove(); dueZone = null; }
/** 放不下时的预览文案：是截止时间挡住的就直说 */
const badLabel = (want, dur, cap) => want + dur > cap ? '超过截止时间' : '此处放不下';
function edgeScroll(e) {
  const r = timelineEl.getBoundingClientRect();
  if (e.clientY < r.top + 46) timelineEl.scrollTop -= 12;
  else if (e.clientY > r.bottom - 46) timelineEl.scrollTop += 12;
}

/* — 从待办池拖出 — */
$('#pool').addEventListener('pointerdown', e => {
  if (e.button !== 0 || isPhone()) return;        /* 手机上时间轴在另一页，拖不过去，用 ↳ 排入 */
  if (e.target.closest('button')) return;
  const el = e.target.closest('.task');
  if (!el || el.classList.contains('placed')) return;
  if (e.pointerType === 'touch' && !e.target.closest('.grip')) return;
  const task = taskById(el.dataset.id); if (!task) return;
  drag = { mode: 'new', task, el, x0: e.clientX, y0: e.clientY, live: false };
});

/* — 时间轴上按下 — */
surface.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  if (e.target.closest('.b-acts') || e.target.closest('.slot-x')) return;

  const edge = e.target.closest('.slot-h');
  if (edge) {
    const sl = state.slots.find(x => x.id === edge.parentElement.dataset.id);
    if (!sl) return;
    e.preventDefault();
    drag = { mode: 'resize', slot: sl, edge: edge.dataset.edge, live: true };
    return;
  }
  const blk = e.target.closest('.block');
  if (blk) {
    const b = state.blocks.find(x => x.id === blk.dataset.id);
    if (!b) return;
    e.preventDefault();
    drag = { mode: 'move', block: b, el: blk, grab: surfaceY(e.clientY) - m2y(b.start), x0: e.clientX, y0: e.clientY, live: false };
    if (e.pointerType === 'touch') {
      /* 触屏：色块铺满了时间轴，在上面划动得是滚动；按住不动一会儿才算拎起来 */
      drag.hold = setTimeout(() => {
        if (!drag || drag.el !== blk) return;
        drag.hold = 0; drag.lifted = true;
        blk.classList.add('lifted');
        navigator.vibrate?.(12);
      }, 380);
    }
    return;
  }
  if (e.pointerType === 'touch') return;          /* 触屏留给滚动 */
  if (e.target.closest('.slot')) return;          /* 已有时间段内部不刷新的 */
  e.preventDefault();
  drag = { mode: 'paint', a: clamp(snap(y2m(surfaceY(e.clientY))), 0, 1440), live: true };
});

window.addEventListener('pointermove', e => {
  if (!drag) return;
  if (!drag.live) {
    const dist = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
    if (drag.hold) { if (dist > 8) dropDrag(); return; }   /* 没等到长按就动了＝在滚动 */
    if (dist < 5) return;
    drag.live = true;
    if (drag.mode === 'new') {
      drag.el.classList.add('dragging');
      const tag = tagById(drag.task.tagId);
      dghost = document.createElement('div');
      dghost.className = 'drag-ghost';
      dghost.style.cssText = cvars(tag.color);
      dghost.innerHTML = `${esc(drag.task.title)}<em>${fmtD(taskMins(drag.task))}</em>`;
      document.body.appendChild(dghost);
      showDueZone(drag.task);
    } else if (drag.mode === 'move') {
      drag.el.classList.add('dragging');
      showDueZone(taskById(drag.block.taskId));
    }
  }
  const dk = state.ui.date;
  edgeScroll(e);

  if (drag.mode === 'new') {
    dghost.style.left = e.clientX + 'px';
    dghost.style.top = e.clientY + 'px';
    if (!overSurface(e)) return killPreview();
    const dur = taskMins(drag.task), cap = dueCap(drag.task, dk);
    const want = clamp(magnet(dk, y2m(surfaceY(e.clientY)), null), 0, 1440 - dur);
    const s = findPlacement(dk, dur, want, null, false, 0, cap);
    drag.result = s;
    if (s === null) showPreview(m2y(want), dur * VIEW.ppm, badLabel(want, dur, cap), 'bad');
    else showPreview(m2y(s), dur * VIEW.ppm, `${fmtT(s)} – ${fmtT(s + dur)}`);
    return;
  }
  if (drag.mode === 'move') {
    const b = drag.block, dur = b.end - b.start, cap = dueCap(taskById(b.taskId), dk);
    const want = clamp(magnet(dk, y2m(surfaceY(e.clientY) - drag.grab), b.id), 0, 1440 - dur);
    const s = findPlacement(dk, dur, want, b.id, false, 0, cap);
    drag.result = s;
    if (s === null) showPreview(m2y(want), dur * VIEW.ppm, badLabel(want, dur, cap), 'bad');
    else showPreview(m2y(s), dur * VIEW.ppm, `${fmtT(s)} – ${fmtT(s + dur)}`);
    return;
  }
  if (drag.mode === 'paint') {
    const b = clamp(snap(y2m(surfaceY(e.clientY))), 0, 1440);
    const lo = Math.min(drag.a, b), hi = Math.max(drag.a, b);
    drag.b = b;
    showPreview(m2y(lo), (hi - lo) * VIEW.ppm, `可用 ${fmtT(lo)} – ${fmtT(hi)} · ${fmtD(hi - lo)}`, 'paint');
    return;
  }
  if (drag.mode === 'resize') {
    const sl = drag.slot;
    const m = clamp(snap(y2m(surfaceY(e.clientY))), 0, 1440);
    const inside = blocksFor(sl.date).filter(x => x.start >= sl.start && x.end <= sl.end);
    const others = slotsFor(sl.date).filter(x => x.id !== sl.id);
    let s = sl.start, en = sl.end;
    if (drag.edge === 't') {
      const limit = Math.min(inside.length ? Math.min(...inside.map(x => x.start)) : en - SNAP, en - SNAP);
      const floor = Math.max(0, ...others.filter(o => o.end <= sl.start).map(o => o.end));
      s = clamp(m, floor, limit);
    } else {
      const limit = Math.max(inside.length ? Math.max(...inside.map(x => x.end)) : s + SNAP, s + SNAP);
      const ceil = Math.min(1440, ...others.filter(o => o.start >= sl.end).map(o => o.start));
      en = clamp(m, limit, ceil);
    }
    drag.next = { s, e: en };
    showPreview(m2y(s), (en - s) * VIEW.ppm, `${fmtT(s)} – ${fmtT(en)} · ${fmtD(en - s)}`, 'paint');
  }
});

/** 收拾拖拽的残局（不提交），返回刚结束的那次拖拽 */
function dropDrag() {
  const d = drag; drag = null;
  if (!d) return null;
  clearTimeout(d.hold);
  dghost?.remove(); dghost = null;
  killPreview(); killDueZone();
  d.el?.classList.remove('dragging', 'lifted');
  return d;
}
window.addEventListener('pointercancel', dropDrag);   /* 浏览器把这次触摸接去滚动了 */
/* 拎起来之后就不让时间轴再跟着滚；没拎起来的划动照常滚动 */
timelineEl.addEventListener('touchmove', e => { if (drag?.lifted) e.preventDefault(); }, { passive: false });
surface.addEventListener('contextmenu', e => { if (drag?.mode === 'move') e.preventDefault(); });   /* 安卓长按会弹菜单 */

window.addEventListener('pointerup', e => {
  const d = dropDrag();
  if (!d) return;

  if (!d.live) {                                   /* 没移动 = 点击：露出 / 收起色块上的按钮 */
    if (d.mode === 'move') {
      $$('.block.sel').forEach(x => { if (x !== d.el) x.classList.remove('sel'); });
      d.el.classList.toggle('sel');
    }
    return;
  }
  const dk = state.ui.date;

  if (d.mode === 'new') {
    if (!overSurface(e)) return;
    const dur = taskMins(d.task), cap = dueCap(d.task, dk);
    if (d.result === null) {
      if (cap < dur) return toast(`「${d.task.title}」截止于 ${fmtDue(dueOf(d.task))}，不能排在这一天`);
      const want = clamp(snap(y2m(surfaceY(e.clientY))), 0, 1440 - dur);
      return toast(want + dur > cap ? `截止 ${fmtT(cap)} 之前这里没有可用时间` : '该位置没有可用时间', {
        label: '仍要放入', fn: () => {
          const s = findPlacement(dk, dur, want, null, true, 0, cap);
          if (s === null) return toast(cap < 1440 ? '截止之前已经排满了' : '这一天已经排满了');
          snapshot();
          addSlot(dk, s, s + dur);
          const b = { id: uid(), taskId: d.task.id, date: dk, start: s, end: s + dur };
          state.blocks.push(b); save(); renderAll(); flashBlock(b.id);
          toast(`已顺带把 ${fmtT(s)}–${fmtT(s + dur)} 设为可用时间`);
        }
      });
    }
    snapshot();
    const b = { id: uid(), taskId: d.task.id, date: dk, start: d.result, end: d.result + dur };
    state.blocks.push(b); save(); renderAll(); flashBlock(b.id);
    return;
  }
  if (d.mode === 'move') {
    if (d.result === null) { d.el.classList.add('shake'); setTimeout(() => d.el.classList.remove('shake'), 320); return; }
    if (d.result === d.block.start) return;
    snapshot();
    const dur = d.block.end - d.block.start;
    d.block.start = d.result; d.block.end = d.result + dur;
    save(); renderAll();
    return;
  }
  if (d.mode === 'paint') {
    const lo = Math.min(d.a, d.b ?? d.a), hi = Math.max(d.a, d.b ?? d.a);
    if (hi - lo < SNAP) return;
    snapshot(); addSlot(dk, lo, hi); save(); renderAll();
    return;
  }
  if (d.mode === 'resize') {
    if (!d.next) return;
    snapshot();
    d.slot.start = d.next.s; d.slot.end = d.next.e;
    mergeSlots(d.slot.date);
    save(); renderAll();
  }
});

/* 时间轴按钮 */
surface.addEventListener('click', e => {
  const del = e.target.closest('.slot-x');
  if (del) return delSlot(del.closest('.slot').dataset.id);
  const btn = e.target.closest('.b-acts button'); if (!btn) return;
  const b = state.blocks.find(x => x.id === btn.closest('.block').dataset.id); if (!b) return;
  if (btn.dataset.act === 'done') removeTask(b.taskId, true);
  if (btn.dataset.act === 'back') unplace(b.taskId);
  if (btn.dataset.act === 'edit') openTask(b.taskId);
});
surface.addEventListener('dblclick', e => {
  const blk = e.target.closest('.block'); if (blk) {
    const b = state.blocks.find(x => x.id === blk.dataset.id);
    if (b) openTask(b.taskId);
  }
});

/* ============================================================
   结算
   ============================================================ */
const rdlg = $('#reviewDialog');
$('#btnReview').onclick = () => { renderReview(); rdlg.showModal(); };
$('#rvClose').onclick = () => rdlg.close();

function renderReview() {
  const list = overdue();
  $('#rvList').innerHTML = list.length ? list.map(b => {
    const t = taskById(b.taskId); if (!t) return '';
    const tag = tagById(t.tagId);
    return `<div class="rvitem" data-id="${b.id}" style="${cvars(tag.color)}">
      <div class="rv-when"><b>${b.date === todayKey() ? '今天' : shortDate(b.date)}</b>${fmtT(b.start)}–${fmtT(b.end)}</div>
      <div class="rv-t">${esc(t.title)}<small>${esc(tag.name)} · ${fmtD(b.end - b.start)}</small></div>
      <div class="rv-btns">
        <button class="ghost-btn accent" data-act="done">完成</button>
        <button class="ghost-btn" data-act="back">未完成</button>
        <button class="ghost-btn" data-act="later" title="移到今天最近的空档">顺延</button>
      </div></div>`;
  }).join('') : `<div class="empty"><b>没有需要结算的日程</b>已过时的安排都处理完了</div>`;
}
$('#rvList').onclick = e => {
  const btn = e.target.closest('button[data-act]'); if (!btn) return;
  const id = btn.closest('.rvitem').dataset.id;
  const b = state.blocks.find(x => x.id === id); if (!b) return;
  const act = btn.dataset.act;
  if (act === 'done') removeTask(b.taskId, true);
  if (act === 'back') unplace(b.taskId);
  if (act === 'later') {
    const dur = b.end - b.start, t = taskById(b.taskId);
    const fl = floorOf(todayKey()), cap = dueCap(t, todayKey());
    const s = findPlacement(todayKey(), dur, fl, b.id, false, fl, cap);
    if (s === null) return toast(cap - fl < dur ? `「${t.title}」已经来不及在截止前做完了，可以改一下截止时间` : '今天已经没有空档了');
    snapshot();
    b.date = todayKey(); b.start = s; b.end = s + dur;
    save(); renderAll();
    toast(`已顺延到今天 ${fmtT(s)}`, { label: '撤销', fn: undo });
  }
  renderReview(); renderBadge();
};

/* ============================================================
   备份
   ============================================================ */
$('#btnTheme').onclick = cycleTheme;
$('#btnUndo').onclick = undo;
$('#btnExport').onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `日程备份-${todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast('已导出备份文件');
};
$('#btnImport').onclick = () => $('#fileImport').click();
$('#fileImport').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const p = JSON.parse(r.result);
      if (!Array.isArray(p.tasks) || !Array.isArray(p.blocks)) throw 0;
      snapshot();
      state = normState(p);
      save(); resetNewTag(); renderAll();
      toast(`已导入 ${state.tasks.length} 项任务`, { label: '撤销', fn: undo });
    } catch (err) { toast('文件格式不对，导入失败'); }
  };
  r.readAsText(f);
  e.target.value = '';
};

/* ============================================================
   导出文档：把某段日期范围排定好的日程编排成一份可打印的 HTML
   ============================================================ */
const expDlg = $('#exportDialog');
let expMode = 'today';

function weekRange(dk) {
  const d = dateOf(dk), day = d.getDay();
  const mon = new Date(d); mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return [keyOf(mon), keyOf(sun)];
}
function monthRange(dk) {
  const d = dateOf(dk);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return [keyOf(first), keyOf(last)];
}
function allRange() {
  const keys = [...state.slots.map(s => s.date), ...state.blocks.map(b => b.date), ...state.log.map(l => l.date)].sort();
  return keys.length ? [keys[0], keys[keys.length - 1]] : [todayKey(), todayKey()];
}
function expRangeKeys() {
  if (expMode === 'today') return [todayKey(), todayKey()];
  if (expMode === 'week') return weekRange(state.ui.date);
  if (expMode === 'month') return monthRange(state.ui.date);
  if (expMode === 'all') return allRange();
  let s = $('#expStart').value || todayKey(), en = $('#expEnd').value || s;
  if (en < s) [s, en] = [en, s];
  return [s, en];
}
function updateExpSummary() {
  const [s, en] = expRangeKeys();
  $('#expSummary').textContent = s === en ? `将导出 ${cnDate(s)} 一天` : `将导出 ${cnDate(s)} 至 ${cnDate(en)}`;
}

const DOC_CSS = `
:root{
  --paper:#F2EDE1; --paper-hi:#FBF8F1; --ink:#23211C; --ink-2:#4C473C; --ink-3:#837B6B; --ink-4:#A79E8B;
  --cinnabar:#B23A22; --rule:rgba(35,33,28,.14); --rule-hard:rgba(35,33,28,.30);
  --serif:"Noto Serif SC","Source Han Serif SC","Songti SC","STSong","SimSun","Microsoft YaHei",serif;
  --sans:"Noto Sans SC","PingFang SC","Microsoft YaHei UI","Microsoft YaHei","微软雅黑",sans-serif;
  --mono:"IBM Plex Mono","Cascadia Mono","Consolas",ui-monospace,monospace;
}
*{box-sizing:border-box}
body{margin:0; padding:36px 44px 60px; background:var(--paper); color:var(--ink); font-family:var(--serif); line-height:1.6}
header{margin-bottom:26px; padding-bottom:16px; border-bottom:2px solid var(--ink)}
header h1{margin:0 0 4px; font-size:26px; letter-spacing:.1em; font-weight:600}
header .range{margin:0; font-size:15px; color:var(--ink-2)}
header .meta{margin:6px 0 0; font-family:var(--mono); font-size:11.5px; color:var(--ink-3)}
.printbtn{margin-top:14px; padding:7px 16px; border:1px solid var(--ink-3); border-radius:3px; background:var(--paper-hi); color:var(--ink); font-family:var(--sans); font-size:12.5px; cursor:pointer}
.printbtn:hover{background:var(--ink); color:var(--paper-hi)}
section.day{margin-bottom:28px; break-inside:avoid-page}
section.day h2{margin:0 0 10px; padding-bottom:6px; font-size:16px; font-weight:600; letter-spacing:.04em; border-bottom:1px solid var(--rule-hard); display:flex; align-items:baseline; gap:8px}
.tag-today{font-family:var(--sans); font-size:10.5px; font-weight:400; color:var(--cinnabar); border:1px solid var(--cinnabar); border-radius:8px; padding:1px 8px}
table.sched{width:100%; border-collapse:collapse; font-size:13.5px}
table.sched td{padding:7px 8px; border-bottom:1px solid var(--rule); vertical-align:top}
.c-time{font-family:var(--mono); white-space:nowrap; color:var(--ink-2); width:110px}
.c-main{width:100%}
.c-title{color:var(--ink)}
.c-sub,.c-note{font-family:var(--sans); font-size:11.5px; color:var(--ink-3); margin-top:2px}
.c-tag{font-family:var(--sans); font-size:11.5px; color:var(--ink-3); white-space:nowrap}
.c-dur{font-family:var(--mono); font-size:12px; color:var(--ink-3); text-align:right; white-space:nowrap}
.tagdot{display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:5px; vertical-align:middle}
.none{color:var(--ink-4); font-size:13px; margin:0 0 8px}
.donebox{margin-top:8px; padding:8px 10px; background:var(--paper-hi); border-left:3px solid var(--ink-3); border-radius:2px}
.donebox b{font-family:var(--sans); font-size:10.5px; letter-spacing:.14em; color:var(--ink-3); text-transform:uppercase}
.donebox ul{margin:6px 0 0; padding:0; list-style:none; font-size:13px}
.donebox li{padding:2px 0}
.donebox small{color:var(--ink-4); font-family:var(--sans)}
section.pending{margin-top:34px; padding-top:18px; border-top:2px solid var(--ink)}
section.pending h2{margin:0 0 10px; font-size:16px; font-weight:600}
section.pending ul{margin:0; padding:0; list-style:none; font-size:13.5px}
section.pending li{padding:4px 0; border-bottom:1px solid var(--rule)}
section.pending small{color:var(--ink-4); font-family:var(--sans)}
@media print{ body{padding:0 6mm} .no-print{display:none} section.day{break-inside:avoid} }
`;

function buildDocHTML(startKey, endKey, opts) {
  let sections = '', dayCount = 0, totalMin = 0, totalDoneMin = 0;
  for (let dk = startKey; dk <= endKey; dk = shiftKey(dk, 1)) {
    const blks = blocksFor(dk);
    const logItems = opts.includeLog ? state.log.filter(l => l.date === dk) : [];
    if (!blks.length && !logItems.length) continue;
    dayCount++;
    totalMin += blks.reduce((s, b) => s + (b.end - b.start), 0);
    totalDoneMin += logItems.reduce((s, l) => s + l.minutes, 0);

    const rows = blks.map(b => {
      const t = taskById(b.taskId); if (!t) return '';
      const tag = tagById(t.tagId);
      const parent = t.parentId ? taskById(t.parentId) : null;
      return `<tr>
        <td class="c-time">${fmtT(b.start)}–${fmtT(b.end)}</td>
        <td class="c-main"><div class="c-title">${esc(t.title)}</div>
          ${parent ? `<div class="c-sub">${esc(parent.title)}</div>` : ''}
          ${t.note ? `<div class="c-note">${esc(t.note)}</div>` : ''}</td>
        <td class="c-tag"><span class="tagdot" style="background:${esc(tag.color)}"></span>${esc(tag.name)}</td>
        <td class="c-dur">${fmtD(b.end - b.start)}</td>
      </tr>`;
    }).join('');
    const doneRows = logItems.map(l => {
      const tag = tagById(l.tagId);
      return `<li><span class="tagdot" style="background:${esc(tag.color)}"></span>${esc(l.title)} <small>· ${esc(tag.name)} · ${fmtD(l.minutes)}</small></li>`;
    }).join('');

    sections += `<section class="day">
      <h2>${cnDate(dk)}${dk === todayKey() ? ' <span class="tag-today">今天</span>' : ''}</h2>
      ${blks.length ? `<table class="sched"><tbody>${rows}</tbody></table>` : '<p class="none">当日无排定日程</p>'}
      ${logItems.length ? `<div class="donebox"><b>已完成</b><ul>${doneRows}</ul></div>` : ''}
    </section>`;
  }

  let pendingSection = '';
  if (opts.includePending) {
    const list = pending();
    if (list.length) {
      const rows = list.map(t => {
        const tag = tagById(t.tagId);
        const due = dueOf(t);
        return `<li><span class="tagdot" style="background:${esc(tag.color)}"></span>${esc(t.title)} <small>· ${esc(tag.name)} · ${fmtD(t.minutes)}${due ? ` · 截止 ${shortDate(due.date)}${due.min < 1440 ? ' ' + fmtT(due.min) : ''}` : ''}</small></li>`;
      }).join('');
      pendingSection = `<section class="pending"><h2>未排程的待办</h2><ul>${rows}</ul></section>`;
    }
  }

  const rangeLabel = startKey === endKey ? cnDate(startKey) : `${cnDate(startKey)} 至 ${cnDate(endKey)}`;
  const emptyNotice = !dayCount ? `<p class="none">所选范围内没有排定的日程${opts.includeLog ? '或完成记录' : ''}。</p>` : '';

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>日程 · ${esc(rangeLabel)}</title>
<style>${DOC_CSS}</style></head><body>
<header>
  <h1>日程编排</h1>
  <p class="range">${esc(rangeLabel)}</p>
  <p class="meta">共 ${dayCount} 天有排程 · 合计 ${fmtD(totalMin)}${totalDoneMin ? ` · 已完成 ${fmtD(totalDoneMin)}` : ''} · 生成于 ${esc(cnDate(todayKey()))} ${fmtT(nowMin())}</p>
  <button class="printbtn no-print" onclick="print()">打印 / 存为 PDF</button>
</header>
${emptyNotice}${sections}${pendingSection}
</body></html>`;
}

$('#btnExportDoc').onclick = () => {
  expMode = 'today';
  $$('#expRange button').forEach(x => x.classList.toggle('on', x.dataset.r === 'today'));
  $('#expCustomField').hidden = true;
  $('#expStart').value = state.ui.date;
  $('#expEnd').value = state.ui.date;
  updateExpSummary();
  expDlg.showModal();
};
$('#expRange').onclick = e => {
  const b = e.target.closest('button[data-r]'); if (!b) return;
  expMode = b.dataset.r;
  $$('#expRange button').forEach(x => x.classList.toggle('on', x === b));
  $('#expCustomField').hidden = expMode !== 'custom';
  updateExpSummary();
};
$('#expStart').onchange = $('#expEnd').onchange = updateExpSummary;
$('#expCancel').onclick = () => expDlg.close();
$('#exportForm').addEventListener('submit', e => {
  e.preventDefault();
  const [s, en] = expRangeKeys();
  const html = buildDocHTML(s, en, { includeLog: $('#expLog').checked, includePending: $('#expPending').checked });
  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `日程文档-${s === en ? s : s + '~' + en}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  expDlg.close();
  toast('已导出文档，打开后可直接打印或存为 PDF');
});

/* 快捷键 */
window.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); }
  if (e.key === 'Escape') toggleMenu(false);
  if (!typing && !dlg.open && !rdlg.open && !expDlg.open && !$('#acctDialog').open) {
    if (e.key === 'n') { e.preventDefault(); $('#newTitle').focus(); }
    if (e.key === 't') { e.preventDefault(); $('#btnToday').click(); }
    if (e.key === 'ArrowLeft') $('#prevDay').click();
    if (e.key === 'ArrowRight') $('#nextDay').click();
  }
});

/* ============================================================
   导览
   ============================================================ */
const TOUR_SEEN = 'agenda.tour.v1';   /* 单独一个键，不进 state，导入备份不会带回来 */

/* 一步一项：sel 可以是选择器或选择器数组（第一个开亮，其余只描边）；不给 sel 就居中。
   手机上界面不一样（两页切换、按钮收进 ⋯、没有鼠标），psel / pbody 给了就替换 sel / body */
const TOUR = [
  {
    title: '先划时间，再放任务',
    body: `一份<b>本地优先</b>的日程表：不登录也能用，数据就存在这台浏览器里；想在电脑和手机之间同步，登录个账号就行。<br>
      用法就一句话——<em>先划出今天能用的时间，再把任务放进去</em>。<br>
      下面几步走完就都会了，随时可以「跳过」。`
  },
  {
    title: '写下一件事',
    sel: '.compose',
    body: `填名称和<b>时／分</b>，或者直接点 <kbd>15</kbd> <kbd>30</kbd> <kbd>45</kbd> 这些快捷时长。<br>
      挑一个标签（<b>＋ 标签</b> 可以自己造，八种颜料色任选），再「添加到待办」。<br>
      有期限的事点「<b>＋ 截止时间</b>」，之后不管怎么排都不会越过它。<br>
      在名称框里按 <kbd>Enter</kbd> 也能提交。`
  },
  {
    title: '待办 · 拆分',
    sel: '#poolPanel',
    body: `还没安排的任务都堆在这里。鼠标移上去会露出三个按钮：
      <ul><li><b>↳</b> 排进最近的空档</li>
      <li><b>✎</b> 改名称、耗时、标签、备注</li>
      <li><b>✓</b> 直接记为完成</li></ul>
      <b>✎</b> 里还能把一件大事<b>拆分为子任务</b>——拆分后父任务变成一个分组，改为分别安排每条子任务。<br>
      右上角「自动排程」把整个待办按顺序一次铺进空档，有截止的先排。`,
    pbody: `还没安排的任务都堆在这里，每条右边三个按钮：
      <ul><li><b>↳</b> 排进最近的空档，排好会翻到日程页给你看</li>
      <li><b>✎</b> 改名称、耗时、标签、备注</li>
      <li><b>✓</b> 直接记为完成</li></ul>
      <b>✎</b> 里还能把一件大事<b>拆分为子任务</b>，分别安排。<br>
      「自动排程」把整个待办一次铺进空档。`
  },
  {
    title: '今天 · 翻天 · 疏密',
    sel: '.sched-head',
    body: `打开就是<b>今天</b>：报头是走秒的时钟，时间轴上有一条跟着走的朱砂「此刻」线。<br>
      <b>‹ ›</b> 或点日期翻到别的日子，<b>今天</b> 一键回来。<br>
      <b>疏／中／密</b> 调时间轴的松紧。`
  },
  {
    title: '先划出可用时间',
    sel: '.availbar',
    body: `任务只能落在<b>可用时间</b>里，所以先划时间。<br>
      「<b>＋ 时间段</b>」填起止，或用 上午／下午／晚间／全天 预设；「<b>沿用昨日</b>」一键复制前一天。<br>
      相邻、重叠的段会自动合并；用 <b>×</b> 删掉一段时，段里的任务会退回待办。`
  },
  {
    title: '拖进日程表',
    sel: '#timeline',
    body: `这块画布上有三种拖法：
      <ul><li>空白处<b>按住上下拖</b>＝刷出一段可用时间</li>
      <li>把左边的任务<b>拖进来</b>＝排入日程</li>
      <li>拖色块＝改时间，拖时间段的上下边缘＝拉伸</li></ul>
      落点会吸附到 5 分钟刻度、时间段边界和相邻色块边缘，<em>不会重叠，也不会越出可用时间</em>。<br>
      实在放不下会先问你，可以选「仍要放入」，顺带把那一段设为可用。`,
    pbody: `排进来的任务在这里成了色块：
      <ul><li><b>点一下</b>色块＝露出 ✓ ↩ ✎ 三个按钮</li>
      <li><b>长按</b>色块再拖＝改时间</li>
      <li>拖时间段的上下边缘＝拉伸</li></ul>
      落点会吸附到 5 分钟刻度和相邻边缘，<em>不会重叠，也不会越出可用时间</em>。<br>
      平常在上面划动就是上下滚动。`
  },
  {
    title: '这一天的账',
    sel: '#stats',
    body: `可用、已排、尚余、待办——四个数字随时对得上。<br>
      「已排」下面那条朱砂细线，是当天时间的占用比例。`
  },
  {
    title: '完成 · 未完成 · 结算',
    sel: ['#btnReview', '.done-panel'],
    psel: ['#btnReview', '#tabbar [data-view="tasks"]'],
    body: `色块上的 <b>✓</b>＝完成，任务从系统里删掉、记进左下「已完成」；<b>↩</b>＝没做完，退回待办等你重排。<br>
      <b>结算</b>会集中列出所有<em>已经过时</em>的日程（按钮上带红角标），逐条选 完成／未完成／<b>顺延</b>到今天最近的空档。`,
    pbody: `色块上的 <b>✓</b>＝完成，任务从系统里删掉、记进待办页底部的「已完成」；<b>↩</b>＝没做完，退回待办等你重排。<br>
      <b>结算</b>会集中列出所有<em>已经过时</em>的日程（带红角标），逐条选 完成／未完成／<b>顺延</b>到今天最近的空档。`
  },
  {
    title: '昼夜 · 撤销 · 备份',
    sel: '.mast-actions',
    psel: '#btnMore',
    body: `最左边那颗按钮切外观：<b>随系统</b>／<b>浅色</b>／<b>深色</b> 轮着来，夜里自动换上墨色一套。<br>
      <b>撤销</b>（或 <kbd>Ctrl+Z</kbd>）能回退删除、完成、清空、自动排程这些动作，最近四十步都留着。<br>
      <b>导出</b> 存一份 JSON，<b>导入</b> 恢复——没登录的话，换电脑或清浏览器缓存之前记得导出。`,
    pbody: `右上角 <b>⋯</b> 里收着这些：<br>
      <b>外观</b> 在 随系统／浅色／深色 之间轮换；<b>撤销</b> 能回退删除、完成、清空、自动排程这些动作（提示条上也有「撤销」）；
      <b>导出</b> 存一份 JSON，<b>导入</b> 恢复——没登录的话，清浏览器数据之前记得导出。`
  },
  {
    title: '账号 · 多设备同步',
    sel: '#btnAcct',
    body: `不登录时，数据只在这台浏览器里，换个浏览器就是另一套。<br>
      <b>登录</b>（邮箱注册，验证码确认）之后，日程会在你的电脑、手机之间<em>自动同步</em>：<br>
      每一步照旧先存在本机，断网也能接着用，按钮会显示「<b>离线</b>」；联网后自动补上。<br>
      两台设备改了同一件事，以后改的为准；排在同一时段撞车的，会退回待办并提醒你。`
  },
  {
    title: '就这些',
    sel: '#btnTour',
    body: `快捷键：<kbd>N</kbd> 写新任务 · <kbd>T</kbd> 回到今天 · <kbd>←</kbd> <kbd>→</kbd> 翻天 · <kbd>Ctrl+Z</kbd> 撤销。<br>
      想再看一遍，点这里的<b>导览</b>。`,
    psel: '#tabbar',
    pbody: `底栏在 <b>待办</b> 和 <b>日程</b> 两页之间切换，中间的 <b>＋</b> 随手记一件新事。<br>
      想再看一遍导览，在右上角 <b>⋯</b> 里找。`
  },
];

let tourAt = -1, tourEls = [], tourRaf = 0;
const tourOn = () => tourAt >= 0;

function startTour(at) {
  try { localStorage.setItem(TOUR_SEEN, '1'); } catch (e) { }
  if (dlg.open) dlg.close();
  if (rdlg.open) rdlg.close();
  if ($('#acctDialog').open) $('#acctDialog').close();
  toggleMenu(false);
  $('#tour').hidden = false;
  tourStep(at || 0);
  $('#tourNext').focus();
}
function endTour() {
  tourAt = -1; tourEls = [];
  $$('.tour-ring').forEach(r => r.remove());
  $('#tour').hidden = true;
}
function tourStep(i) {
  const n = TOUR.length;
  if (i >= n) return endTour();
  tourAt = clamp(i, 0, n - 1);
  const st = TOUR[tourAt];
  $('#tourCount').textContent = `${tourAt + 1} / ${n}`;
  $('#tourTitle').textContent = st.title;
  const phone = isPhone();
  $('#tourBody').innerHTML = (phone && st.pbody) || st.body;
  $('#tourPrev').disabled = tourAt === 0;
  $('#tourNext').textContent = tourAt === n - 1 ? '开始使用' : '下一步';
  $('#tourDots').innerHTML = TOUR.map((s, k) =>
    `<i${k === tourAt ? ' class="on"' : ''} data-i="${k}" title="${esc(s.title)}"></i>`).join('');
  const sel = (phone && st.psel) || st.sel;
  tourEls = (sel ? [].concat(sel) : []).map(s => $(s)).filter(Boolean);
  /* 手机上目标可能在另一页，先翻过去（视图不进 state，导览照样只读） */
  if (phone && tourEls[0]?.closest('.col')) setView(tourEls[0].closest('.col-tasks') ? 'tasks' : 'sched');
  tourEls[0]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  tourPlace();
  requestAnimationFrame(tourPlace);   /* 滚动落定后再校一次 */
}
/** 把亮区和卡片摆到当前目标旁边；滚动、改窗口大小后重跑 */
function tourPlace() {
  if (!tourOn()) return;
  const hole = $('#tourHole'), card = $('#tourCard');
  const vw = innerWidth, vh = innerHeight;
  const PAD = 7, GAP = 14, M = 10;

  $$('.tour-ring').forEach(r => r.remove());
  let box = null;
  if (tourEls.length) {
    const r = tourEls[0].getBoundingClientRect();
    let l = r.left - PAD, t = r.top - PAD, w = r.width + PAD * 2, h = r.height + PAD * 2;
    if (l < 2) { w += l - 2; l = 2; }
    if (t < 2) { h += t - 2; t = 2; }
    box = { l, t, w: Math.min(w, vw - 4 - l), h: Math.min(h, vh - 4 - t) };
    for (const el of tourEls.slice(1)) {
      const q = el.getBoundingClientRect();
      if (!q.width && !q.height) continue;         /* 藏着的（另一页上的）就不描了 */
      const ring = document.createElement('div');
      ring.className = 'tour-ring';
      ring.style.cssText = `left:${q.left - 4}px;top:${q.top - 4}px;width:${q.width + 8}px;height:${q.height + 8}px`;
      $('#tour').appendChild(ring);
    }
  }
  /* 没有目标时用一个零尺寸的洞，投影照旧铺满整屏 */
  hole.style.left = (box ? box.l : vw / 2) + 'px';
  hole.style.top = (box ? box.t : vh / 2) + 'px';
  hole.style.width = (box ? box.w : 0) + 'px';
  hole.style.height = (box ? box.h : 0) + 'px';

  const cw = card.offsetWidth, ch = card.offsetHeight;
  let x, y;
  if (!box) { x = (vw - cw) / 2; y = (vh - ch) / 2; }
  else if (vw < 640 || vh < 560) {                                  /* 窄屏：上下找地方，找不到就贴底 */
    x = (vw - cw) / 2;
    y = box.t + box.h + GAP;
    if (y + ch > vh - M) y = box.t - GAP - ch;
    if (y < M) y = vh - ch - M;
  }
  else if (vw - (box.l + box.w) >= cw + GAP + M) { x = box.l + box.w + GAP; y = box.t + box.h / 2 - ch / 2; }
  else if (box.l >= cw + GAP + M) { x = box.l - GAP - cw; y = box.t + box.h / 2 - ch / 2; }
  else if (vh - (box.t + box.h) >= ch + GAP + M) { y = box.t + box.h + GAP; x = box.l + box.w / 2 - cw / 2; }
  else if (box.t >= ch + GAP + M) { y = box.t - GAP - ch; x = box.l + box.w / 2 - cw / 2; }
  else { x = vw - cw - M; y = vh - ch - M; }
  card.style.left = Math.round(clamp(x, M, Math.max(M, vw - cw - M))) + 'px';
  card.style.top = Math.round(clamp(y, M, Math.max(M, vh - ch - M))) + 'px';
}

$('#btnTour').onclick = () => startTour(0);
$('#tourNext').onclick = () => tourStep(tourAt + 1);
$('#tourPrev').onclick = () => tourStep(tourAt - 1);
$('#tourSkip').onclick = endTour;
$('#tourDots').onclick = e => {
  const d = e.target.closest('i[data-i]');
  if (d) tourStep(+d.dataset.i);
};
/* 导览进行中吃掉快捷键，别让底下的界面跟着响应 */
window.addEventListener('keydown', e => {
  if (!tourOn()) return;
  if (e.key === 'Escape') endTour();
  else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') tourStep(tourAt + 1);
  else if (e.key === 'ArrowLeft') tourStep(tourAt - 1);
  else return;
  e.preventDefault(); e.stopPropagation();
}, true);
const tourSync = () => {
  if (!tourOn() || tourRaf) return;
  tourRaf = requestAnimationFrame(() => { tourRaf = 0; tourPlace(); });
};
window.addEventListener('resize', tourSync);
window.addEventListener('scroll', tourSync, true);   /* 捕获阶段才收得到内部容器的滚动 */

/* ============================================================
   启动
   ============================================================ */
const BOOT_DAY = todayKey();
applyTheme(false);        /* 只对齐按钮文案，紧接着的 renderAll 会把颜料一并算好 */
renderAll();
tickClock();
scrollToNow(false);
syncBoot();
let tourFirstRun = false;
try { tourFirstRun = !localStorage.getItem(TOUR_SEEN); } catch (e) { }
if (tourFirstRun) setTimeout(() => startTour(0), 450);   /* 等字体和布局落定 */
setInterval(tickClock, 1000);
setInterval(() => { if (!drag) { updateNowLine(); renderBadge(); } }, 20000);
window.addEventListener('resize', () => { if (!drag) renderTimeline(); });
