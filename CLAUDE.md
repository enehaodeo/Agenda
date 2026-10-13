# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

一个纯前端、本地优先的日程表 App（中文界面）。四个静态文件（`index.html` / `styles.css` / `app.js` / `sync.js`）+ localStorage，没有构建步骤、没有依赖、没有测试框架。登录后可经 Supabase 多设备同步（见下文「账号与同步」）。用户 README 在 [README.md](README.md)，六个核心功能的操作说明以那份为准。

## Commands

没有 build / lint / test。开发就是改文件 + 刷新浏览器。

```bash
python -m http.server 5177
```

或双击 `启动.cmd`（同样的命令 + 自动开浏览器）。`.claude/launch.json` 里已配好同名的 `agenda` preview 配置，可直接用 preview_start。

也可以直接双击 `index.html` 以 `file://` 打开——**这是用户的主要使用方式，任何改动都必须保持它可用**。

## Hard constraint: must work from `file://`

这条约束决定了下面所有技术选型，改动时不要破坏：

- `app.js` / `sync.js` 都是**普通 script，不是 ES module**（`type="module"` 在 file:// 下会因 CORS 失败）。所有代码在全局作用域里，靠 `'use strict'` 和注释分区组织；两个文件共享同一个全局词法作用域（`sync.js` 先加载，但它引用 app.js 的 `state` / `save` / `renderAll` 等都在调用时才解析）。
- 不能用 `fetch` / `XMLHttpRequest` 读本地文件。导入备份走 `FileReader`，导出走 `Blob` + `URL.createObjectURL`。
- 字体不能外链文件（Chrome 对 `@font-face` 走 CORS，file:// 下会被判跨源）。所以 `fonts.css` 里是 base64 data URI。
- **未登录时**零外部请求是一条已验证的性质（`performance.getEntriesByType('resource')` 只有本地文件）；登录后也只连 `sync.js` 顶部配置的 Supabase 地址。不要为了方便引入任何 CDN（包括 supabase-js——同步客户端是手写的 fetch）。
- 登录不能依赖跳转回页面（OAuth、魔法链接都回不到 file://），所以注册验证和找回密码都用邮件验证码，全程在页面内完成。

## Architecture

### 主题（深浅两套皮）

- `data-theme="light|dark"` 挂在 `<html>` 上。**首帧之前**由 `index.html` `<head>` 里那段内联小脚本落定（app.js 在 body 末尾，来不及，夜里会先白闪一下）。app.js 的「主题」区只接手后续切换——两边的键名和判断逻辑要一起改。
- 模式三选一：`auto`（跟随 `prefers-color-scheme`，默认）／`light`／`dark`，点报头最左那颗按钮循环。存 `agenda.theme.v1`，**不进 `state`**，所以导入备份不会连别人的外观一起带回来。
- `auto` 下监听 `matchMedia` 的 `change`，系统换色时当场跟着换，不用刷新。
- CSS 只有 `:root` 和 `:root[data-theme="dark"]` 两个变量块，语义不变（`--paper*` 永远是「面」，`--ink*` 永远是「字」），加新颜色时**两边都要给值**，不要在规则里写死颜色。除了变量块，全文件只剩几处刻意写死的黑色投影。
- 需要 rgba 调淡的颜色额外备一份分量：`--cinnabar-rgb`、`--shade`（投影基色，浅色是墨、深色是纯黑）。另有 `--on-accent`（压在朱砂块上的字：浅色用宣白、深色用暗墨）、`--solid` / `--solid-fg`（主按钮、提示条、当前档位这类实心控件）、`--fill-1/2/3`（半透明抬起层）、`--tint-1/2/b`（色块底色浓度，夜里要更浓才浮得起来）。
- **标签颜料要按深浅换算**：`PIGMENTS` 那八个颜料色压在夜色上会糊掉，`lighten()` 抬明度后由 `cvars(hex)` 一次吐出 `--c` 和 `--c-rgb`。所有要着色的元素都走 `cvars()`，不要再手写 `--c:${tag.color}`。切主题时 `applyTheme(true)` 会 `renderAll()` 把颜料重算一遍。
- `color-scheme` 跟着一起切，原生日期／时间选择器和滚动条才会跟着变暗。

### 状态与持久化

单一可变全局 `state`，形状见 `blank()`（app.js 顶部）：

```
{ tasks[], blocks[], slots[], tags[], log[], ui:{date, zoom} }
```

- `state` 用 `let` 声明，因为 `undo()` 会整体替换它。任何长期持有 `state` 子对象引用的代码在 undo 后都会失效。
- 数据存在 `STORE` 键下（`let`，访客是 `agenda.v1`，登录后是 `agenda.u.<uid>.v1`，由 `sync.js` 的 `switchStore()` 切换）。读档统一走 `loadState()` → `normState()`，导入备份也用 `normState()`。
- `save()` = `stampChanges()`（给改过的记录盖 `mt` 修改时间）→ `writeLocal()` → 有数据改动就 `cloudDirty()`。只改 `ui` 的 save 不算改动。
- 写操作的固定节奏：**`snapshot()` → 改 state → `save()` → `renderAll()`**。`snapshot()` 必须在修改前调用（它存的是 `JSON.stringify(state)`）。批量操作（如 `自动排程`）只在最外层 snapshot 一次，内部调用传 `quiet` 跳过 save/render。
- `state.ui.date` 在启动时无条件重置为今天，导入备份时也是。

### 数据模型的四条不变量

1. **任务是扁平列表**，父子关系只靠 `parentId`，且**只允许一层**。`childrenOf()` / `isParent()` 派生。
2. **有子任务的父任务不可排程**。`place()` 对 parent 直接返回 false，保存时若父任务刚获得子任务会撤下它已有的 block。父任务的显示时长 `taskMins()` = 子任务之和（`t.minutes` 字段保留为"计划总时长"，用于拆分界面的"剩余/超出"提示）。
3. **一个任务最多一个 block**（`blockOf()` 用 `find`）。跨日程安排靠 block 上的 `date` 字段，不是多条记录。
4. **block 必须完整落在某个 slot 内且互不重叠**。这条由 `findPlacement()` 保证，不要绕过它直接往 `state.blocks` 里塞。

截止时间（可选）：任务上的 `due = {date, min}`，`min` 是当天分钟数，`1440` 表示「那天之内」；不设就没有这个字段。子任务的有效截止 = 自己和父任务里较早的那个（`dueOf()`）。**block 的结束不得晚于有效截止**——`dueCap(t, dk)` 把它换算成「dk 这天最晚能排到几点结束」（无截止 1440，截止日之后 -1），作为 `findPlacement` 的 `ceil` 传入。所有落位入口（`place`、拖入 / 拖动、「仍要放入」、结算顺延、`revalidate`）都要传，新增落位入口时别漏了。改了截止后靠 `revalidate()` 把已排的就近往前挪或退回待办。

`slots`（可用时间段）在每次增删后调用 `mergeSlots(date)` 合并重叠/相邻区间，所以 slot 的 id 会变，不要长期缓存。

### 排程算法

全部时间用「当天 0 点起的分钟数」表示（0–1440），日期用 `YYYY-MM-DD` 字符串（`keyOf` / `dateOf` / `shiftKey`）。

- `freeIntervals(dk, ignoreId, base)` — slots 减去 blocks，得到空闲区间。`base` 传 `[{s:0,e:1440}]` 可无视可用时间（"仍要放入"用）。
- `findPlacement(dk, dur, desired, ignoreId, anywhere, floor, ceil)` — 返回**离 desired 最近的合法起点**，放不下返回 `null`。这是唯一的落位入口。`ceil`（默认 1440）是结束时刻上限，截止时间走这里。
- `floorOf(dk)` — 今天时返回向上取整到 5 分钟的当前时刻，用于让自动排程/顺延不往过去塞；手动拖拽不传 floor（用户明确指定的位置允许在过去）。
- `magnet(dk, m, ignoreId)` — 先吸附 5 分钟刻度，9 分钟内有 slot 边界或其他 block 边缘则精确对齐。

### 渲染

全量重渲染：`renderAll()` 调六个 `renderXxx()`，各自用 innerHTML 重建。事件监听器在模块顶层用**委托**绑定一次（绑在 `#pool` / `#surface` / `#slotChips` 等容器上），所以重建 DOM 不会丢事件。新增交互请沿用委托，不要在 render 里绑 listener。

时间轴几何在 `computeView(dk)` 里算好存进全局 `VIEW = {lo, hi, ppm}`，`y2m()` / `m2y()` 依赖它。**任何读指针坐标的代码都必须在 `renderTimeline()` 之后运行**，否则 VIEW 是陈旧的。

定时器：`tickClock` 每秒（顺带检测跨日后 reload），now line + 结算角标每 20 秒。两者都要在拖拽进行中跳过重渲染（`if (!drag)`）。

### 拖拽状态机

`drag` 一个对象管四种模式，window 级 `pointermove` / `pointerup`：

| mode | 起点 | 行为 |
|---|---|---|
| `new` | `#pool` 里的 `.task` | 从待办拖入时间轴 |
| `move` | `.block` | 移动已排任务 |
| `paint` | `#surface` 空白处 | 刷出可用时间段 |
| `resize` | `.slot-h` | 拉伸时间段上下沿 |

要点：移动超过 5px 才 `live = true`（否则算点击）；`drag.result` 在 move 阶段算好，`pointerup` 只负责提交，`pointercancel` 走 `dropDrag()` 只收拾不提交；触屏上 `paint` 直接放弃（留给页面滚动），`new` 只从 `.grip` 起手。触屏上的 `move` 要**长按 380ms** 才拎起（`drag.hold` 计时器，其间动超过 8px 就算滚动、放弃）；`.block` 是 `touch-action:pan-y`，拎起之后靠时间轴上非 passive 的 `touchmove` 里 `preventDefault()` 挡住滚动。

### 手机布局（≤720px）

断点写在两处，要一起改：styles.css「手机」区的 `@media (max-width:720px)` 和 app.js 的 `PHONE`。

- 整页变成「报头 + 一页 + 底栏 `#tabbar`」的壳，`body` 固定 `100dvh` 不滚，各页自己滚。两栏靠 `body[data-view="tasks|sched"]` 只显示一栏，`setView()` 切换；视图不进 `state`，也不存盘。日程页藏起来时时间轴 `scrollTop` 会丢，`setView` 用 `tlKeep` 还原。
- 手机上不从待办拖进时间轴（另一页看不见），改为 `↳` 排入后 `showPlaced()` 翻到日程页闪一下。
- 报头按钮包在 `#mastMenu` 里：桌面平铺，手机收进 `#btnMore`（⋯）弹出的菜单。`#btnAcct` 在菜单外，始终可见。
- 对话框在手机上是从底部升起的抽屉；输入框字号一律 16px（iOS 小于 16px 聚焦会放大整页）。
- 导览步骤可带 `psel` / `pbody`，手机上替换 `sel` / `body`；目标在另一页时 `tourStep` 会先 `setView` 翻过去（不动 state，导览仍是只读）。
- `(hover:none)` 下本来悬停才露的按钮常驻并放大，时间段拉伸手柄加高到 22px。

### 账号与同步（sync.js）

- 配置只有顶部 `SUPABASE_URL` / `SUPABASE_ANON` 两个常量，留空 = `CLOUD_READY` 为假，App 纯本地。云端结构在 `supabase/schema.sql`：每个用户一行 `agendas {user_id, doc jsonb, rev}`，只开放 select；写入只走 `push_agenda(p_doc, p_base_rev)`（rev 乐观锁，对不上返回 -1）。
- 存储键：`agenda.acct.v1` 会话；`agenda.u.<uid>.v1` 账号的本机副本；`agenda.u.<uid>.sync.v1` 是 `{base, rev, at}`，`base` = 上次同步成功时的数据，三方合并的公共祖先。访客数据 `agenda.v1` 不受登录影响，首次登录时可「并入账号」。
- 同步的只有 `DATA_KEYS`（tasks / blocks / slots / tags / log），`ui` 属于设备不同步。`dataOf()` 是**深拷贝**——`syncOnce()` 里有 await，必须拿快照而不是 state 的引用，否则推送途中本机的新改动会被误记进 base。
- `sync()` 流程：pull → 云端 rev 变了就 `merge3(base, 本地, 云端)` → `repairData()` 修不变量 → 结果和本地不同就 `adoptData()` → 推送 → 成功后写 base/rev；推送返回 -1 就重来（最多 4 轮）。单飞，进行中再触发只补一轮。触发：`save()` 后防抖 1.5s、`online`、页面回到前台、前台每 60 秒。
- `merge3` 按 id 逐条：只有一边改 → 用那边；两边都改 → 比 `mt`；一边删一边改 → 保留改的。所以**不要删掉记录上的 `mt` 字段**，也不要在别处手动写它（`stampChanges` 会在 `mergeSlots` 这类重建对象时把旧 `mt` 补回去）。
- `repairData` 在合并后恢复上面四条不变量（孤儿子任务变顶层、父任务 / 已删任务 / 重复的 block 删掉、同日时间段合并），并且**只在这次合并碰过的日子里**检查 block 重叠、越出时间段、时长与任务不符——冲突时 `mt` 旧的退回待办并 toast。越过截止时间的 block 也退回待办（这条不限于被碰过的日子）。
- `adoptData()` 替换 state 后会**清空撤销栈**：旧快照不含别的设备的改动，撤销会把它们吞掉。拖拽进行中（`drag` 非空）不 adopt，1.5 秒后重试。
- 多标签页：监听 `storage` 事件，别的标签页写了当前 `STORE` 就跟着重载数据，写了 `agenda.acct.v1` 就跟着换账号；access token 刷新前先看磁盘上有没有别的页刚换好的。
- 纯函数（`merge3` / `repairData` / `dataOf`）不碰 DOM，可以在 Node 里用 `vm.runInThisContext` 载入 sync.js 单测。
- 界面：报头最右 `#btnAcct` 同时是账号入口和同步状态（`data-st` = synced / syncing / offline / error / relogin），`#acctDialog` 里 `acctMode` 在 in / up / up-code / reset / reset-code 之间切换。

### 导览

`app.js` 末尾的「导览」区，遮罩式分步导览。加减步骤只改 `TOUR` 数组：`title` / `body`（HTML，直接 innerHTML）/ `sel`（选择器，或选择器数组——第一个开亮，其余只用 `.tour-ring` 描边；不给 `sel` 就是居中的纯文字步）。

- 暗场是 `#tourHole` 的 `box-shadow: 0 0 0 9999px` 打出来的洞，**不是**给目标元素抬 z-index——`.layout`（z-index:10）和 `.masthead`（20）各自是层叠上下文，子元素抬不出去。代价是一步只能有一个亮区。
- 居中步用一个零尺寸的洞，投影照样铺满整屏。
- `tourPlace()` 先同步摆一次，再在 `requestAnimationFrame` 里校一次（等 `scrollIntoView` 落定）；另外挂在 `resize` 和**捕获阶段**的 `scroll` 上（内部容器的滚动不冒泡）。卡片方位按「右→左→下→上」取第一个放得下的，窄屏改成上下找、找不到就贴底。
- 导览期间键盘事件在 window 捕获阶段就被吃掉，底下的 `n` / `t` / `←` `→` 不会跟着响应；遮罩本身吞掉所有点击。所以导览全程只读——不动 `state`、不 `snapshot()`、不进撤销栈。
- 「看过导览」单独存 `agenda.tour.v1`，不进 `state`，所以导入备份不会把它带回来。

## 两个已经踩过的坑

- **`.surface` 必须有显式高度**。它的子元素全是绝对定位，不给高度的话 `getBoundingClientRect()` 返回 height 0，所有命中测试静默失效。高度设在 `#surface` 上（不是 `#tlInner`）。
- **`[hidden]{display:none !important}`** 在 styles.css 顶部是必需的。`.slot-form` / `.badge` 这类元素的 CSS 有 `display:flex|inline-grid`，会盖掉 `hidden` 属性的 UA 样式。

## 样式约定

所有颜色/字体/圆角在 [styles.css](styles.css) 顶部的 `:root` 里（白天「宣纸朱砂」：`--paper*` 纸、`--ink*` 墨、`--cinnabar*` 朱；夜里「灯下研墨」在紧接着的 `:root[data-theme="dark"]` 里，同名同义只换值）。标签颜色用 `PIGMENTS` 里的颜料色，元素上同时设 `--c`（hex）和 `--c-rgb`（供 `rgba()` 用），一律由 `cvars()` 生成——它会按当前深浅决定要不要提亮。

字体：中文走系统已装的 Noto Serif SC / Noto Sans SC（有回落链），只有拉丁的 Fraunces + IBM Plex Mono 是内嵌的。

**`fonts.css` 是生成物，不要手改。** 需要换拉丁字体时：从 Google Fonts 取 latin 子集的 woff2 存进 `fonts/`，再重新生成整个文件（base64 编码 + 三条 `@font-face`）。`fonts/` 里的原始 woff2 只作留档，页面不引用。

## 写代码时

界面文案、注释、toast 全用中文。破坏性操作一律走 `snapshot()` + 带「撤销」按钮的 `toast(msg, {label, fn})`，不要用原生 `confirm()`。
