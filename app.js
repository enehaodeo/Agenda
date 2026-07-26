/* ============================================================
   日程 · 手工排程   app.js
   纯前端，无依赖，数据存 localStorage
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
const shiftKey = (k, n) => { const d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hexRgb = h => {
  const x = h.replace('#', '');
  const n = parseInt(x.length === 3 ? x.split('').map(c => c + c).join('') : x, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};
const hm2min = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
const min2hm = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/* ---------------------------------------------------------- 状态 */
const STORE = 'agenda.v1';
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
let state = blank();
try {
  const raw = localStorage.getItem(STORE);
  if (raw) {
    const p = JSON.parse(raw);
    state = Object.assign(blank(), p);
    state.ui = Object.assign({ date: todayKey(), zoom: 1 }, p.ui || {});
    if (!state.tags?.length) state.tags = DEFAULT_TAGS.map(t => ({ ...t }));
  }
} catch (e) { console.warn('读取本地数据失败，已重置', e); }
state.ui.date = todayKey();

const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { toast('保存失败：浏览器存储空间不足'); } };

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
/** 找到离 desired 最近的合法起点；floor 之前的时间不考虑；放不下返回 null */
function findPlacement(dk, dur, desired, ignoreId, anywhere, floor) {
  const base = anywhere ? [{ s: 0, e: 1440 }] : null;
  let best = null;
  for (const iv of freeIntervals(dk, ignoreId, base)) {
    const lo = Math.max(iv.s, floor || 0);
    if (iv.e - lo < dur) continue;
    const s = clamp(desired, lo, iv.e - dur);
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

/* ============================================================
   渲染
   ============================================================ */
function renderAll() {
  renderHeader(); renderPool(); renderLog(); renderAvail(); renderTimeline(); renderStats(); renderBadge();
}

function renderHeader() {
  $('#todayDate').textContent = cnDate(todayKey());
  $('#viewDate').textContent = cnDate(state.ui.date) + (state.ui.date === todayKey() ? ' · 今天' : '');
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
  return `<div class="${cls.join(' ')}" data-id="${t.id}" style="--c:${tag.color};--c-rgb:${hexRgb(tag.color)}">
    ${blk ? '<span class="grip" style="opacity:.4">✓</span>' : '<span class="grip">⠿</span>'}
    <div class="t-main">
      <div class="t-title">${esc(t.title)}</div>
      <div class="t-meta">
        <span class="m-dur">${fmtD(t.minutes)}</span>
        <span class="m-tag"><i></i>${esc(tag.name)}</span>
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
      return `<div class="group${closed}" data-gid="${p.id}">
        <div class="group-head">
          <span class="caret">▼</span>
          <span class="g-title">${esc(p.title)}</span>
          <span class="g-meta">${fmtD(total)} · 已排 ${doneN}/${kids.length}</span>
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
    <div class="stat"><div class="s-lab">待办</div><div class="s-val">${pend.length}<small>项</small>${pmin ? ' ' + fmtDH(pmin) : ''}</div></div>`;
}

function renderBadge() {
  const n = overdue().length;
  const b = $('#reviewBadge');
  b.hidden = !n; b.textContent = n;
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
      style="top:${m2y(b.start)}px;height:${Math.max(h, 20)}px;--c:${tag.color};--c-rgb:${hexRgb(tag.color)}">
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
      em.innerHTML = `<b>这一天还是空白的</b>先点「＋ 时间段」选取可用时间<br>或直接在时间轴上按住鼠标上下拖动`;
      $('#tlInner').insertBefore(em, $('#surface'));
    }
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
        style="--c:${t.color};--c-rgb:${hexRgb(t.color)}"><i></i>${esc(t.name)}</button>`).join('')
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
    <div class="tag-swatches">${PIGMENTS.map(c => `<i data-c="${c}" class="${c === color ? 'on' : ''}" style="--c:${c}"></i>`).join('')}</div>
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
if (!state.tags.some(t => t.id === newTag)) newTag = state.tags[0].id;
renderTagPicker($('#newTags'), newTag, id => newTag = id);

$('#newQuick').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  const m = +b.dataset.min;
  $('#newH').value = Math.floor(m / 60); $('#newM').value = m % 60;
};
function addTask() {
  const title = $('#newTitle').value.trim();
  if (!title) { $('#newTitle').focus(); return toast('先写个任务名'); }
  const mins = (+$('#newH').value || 0) * 60 + (+$('#newM').value || 0);
  if (mins < 1) return toast('耗时至少 1 分钟');
  snapshot();
  state.tasks.push({ id: uid(), title, minutes: mins, tagId: newTag, note: '', parentId: null, createdAt: Date.now() });
  save();
  $('#newTitle').value = '';
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
  renderTagPicker($('#fTags'), fTag, v => fTag = v);
  subDraft = childrenOf(id).map(c => ({ id: c.id, title: c.title, minutes: c.minutes, tagId: c.tagId }));
  $('#splitSection').hidden = !!t.parentId;
  renderSplit();
  dlg.showModal();
  $('#fTitle').focus(); $('#fTitle').select();
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

  snapshot();
  t.title = title; t.tagId = fTag; t.note = $('#fNote').value.trim();
  t.minutes = Math.max(mins, 1);

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

/** 时长变化后重新校验已排日程 */
function revalidate(taskId) {
  const b = blockOf(taskId); if (!b) return;
  const t = taskById(taskId); if (!t) return;
  const d = taskMins(t);
  if (b.end - b.start === d) return;
  const s = findPlacement(b.date, d, b.start, b.id);
  if (s === null) {
    state.blocks = state.blocks.filter(x => x.id !== b.id);
    toast(`「${t.title}」时长变更后放不下，已退回待办`);
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
  save(); renderAll();
  toast(complete ? `已完成「${t.title}」` : `已删除「${t.title}」`, { label: '撤销', fn: undo });
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
  const floor = floorOf(dk);
  const s = findPlacement(dk, d, floor, null, false, floor);
  if (s === null) {
    if (!quiet) toast(`${shortDate(dk)} 可用时间不足，放不下 ${fmtD(d)}`, { label: '添加时间段', fn: () => $('#btnAddSlot').click() });
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
    if (act === 'place') place(id);
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
  const list = pending();
  if (!list.length) return toast('待办已经空了');
  snapshot();
  let ok = 0;
  for (const t of list) if (place(t.id, state.ui.date, true)) ok++;
  save(); renderAll();
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
function edgeScroll(e) {
  const r = timelineEl.getBoundingClientRect();
  if (e.clientY < r.top + 46) timelineEl.scrollTop -= 12;
  else if (e.clientY > r.bottom - 46) timelineEl.scrollTop += 12;
}

/* — 从待办池拖出 — */
$('#pool').addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
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
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    drag.live = true;
    if (drag.mode === 'new') {
      drag.el.classList.add('dragging');
      const tag = tagById(drag.task.tagId);
      dghost = document.createElement('div');
      dghost.className = 'drag-ghost';
      dghost.style.setProperty('--c', tag.color);
      dghost.innerHTML = `${esc(drag.task.title)}<em>${fmtD(taskMins(drag.task))}</em>`;
      document.body.appendChild(dghost);
    } else if (drag.mode === 'move') drag.el.classList.add('dragging');
  }
  const dk = state.ui.date;
  edgeScroll(e);

  if (drag.mode === 'new') {
    dghost.style.left = e.clientX + 'px';
    dghost.style.top = e.clientY + 'px';
    if (!overSurface(e)) return killPreview();
    const dur = taskMins(drag.task);
    const want = clamp(magnet(dk, y2m(surfaceY(e.clientY)), null), 0, 1440 - dur);
    const s = findPlacement(dk, dur, want, null);
    drag.result = s;
    if (s === null) showPreview(m2y(want), dur * VIEW.ppm, '此处放不下', 'bad');
    else showPreview(m2y(s), dur * VIEW.ppm, `${fmtT(s)} – ${fmtT(s + dur)}`);
    return;
  }
  if (drag.mode === 'move') {
    const b = drag.block, dur = b.end - b.start;
    const want = clamp(magnet(dk, y2m(surfaceY(e.clientY) - drag.grab), b.id), 0, 1440 - dur);
    const s = findPlacement(dk, dur, want, b.id);
    drag.result = s;
    if (s === null) showPreview(m2y(want), dur * VIEW.ppm, '此处放不下', 'bad');
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

window.addEventListener('pointerup', e => {
  if (!drag) return;
  const d = drag; drag = null;
  dghost?.remove(); dghost = null;
  killPreview();
  d.el?.classList.remove('dragging');

  if (!d.live) {                                   /* 没移动 = 点击 */
    if (d.mode === 'move') { d.el.classList.toggle('sel'); }
    return;
  }
  const dk = state.ui.date;

  if (d.mode === 'new') {
    if (!overSurface(e)) return;
    const dur = taskMins(d.task);
    if (d.result === null) {
      const want = clamp(snap(y2m(surfaceY(e.clientY))), 0, 1440 - dur);
      return toast('该位置没有可用时间', {
        label: '仍要放入', fn: () => {
          const s = findPlacement(dk, dur, want, null, true);
          if (s === null) return toast('这一天已经排满了');
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
    return `<div class="rvitem" data-id="${b.id}" style="--c:${tag.color}">
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
    const dur = b.end - b.start;
    const fl = floorOf(todayKey());
    const s = findPlacement(todayKey(), dur, fl, b.id, false, fl);
    if (s === null) return toast('今天已经没有空档了');
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
      state = Object.assign(blank(), p);
      state.ui = Object.assign({ date: todayKey(), zoom: 1 }, p.ui || {});
      state.ui.date = todayKey();
      save(); renderAll();
      toast(`已导入 ${state.tasks.length} 项任务`, { label: '撤销', fn: undo });
    } catch (err) { toast('文件格式不对，导入失败'); }
  };
  r.readAsText(f);
  e.target.value = '';
};

/* 快捷键 */
window.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); }
  if (!typing && !dlg.open && !rdlg.open) {
    if (e.key === 'n') { e.preventDefault(); $('#newTitle').focus(); }
    if (e.key === 't') { e.preventDefault(); $('#btnToday').click(); }
    if (e.key === 'ArrowLeft') $('#prevDay').click();
    if (e.key === 'ArrowRight') $('#nextDay').click();
  }
});

/* ============================================================
   启动
   ============================================================ */
const BOOT_DAY = todayKey();
renderAll();
tickClock();
scrollToNow(false);
setInterval(tickClock, 1000);
setInterval(() => { if (!drag) { updateNowLine(); renderBadge(); } }, 20000);
window.addEventListener('resize', () => { if (!drag) renderTimeline(); });
