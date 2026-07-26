# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

一个纯前端的本地日程表 App（中文界面）。三个静态文件 + localStorage，没有构建步骤、没有依赖、没有测试框架、没有 git 仓库。用户 README 在 [README.md](README.md)，六个核心功能的操作说明以那份为准。

## Commands

没有 build / lint / test。开发就是改文件 + 刷新浏览器。

```bash
python -m http.server 5177
```

或双击 `启动.cmd`（同样的命令 + 自动开浏览器）。`.claude/launch.json` 里已配好同名的 `agenda` preview 配置，可直接用 preview_start。

也可以直接双击 `index.html` 以 `file://` 打开——**这是用户的主要使用方式，任何改动都必须保持它可用**。

## Hard constraint: must work from `file://`

这条约束决定了下面所有技术选型，改动时不要破坏：

- `app.js` 是**普通 script，不是 ES module**（`type="module"` 在 file:// 下会因 CORS 失败）。所有代码在一个顶层 IIFE 之外的全局作用域里，靠 `'use strict'` 和注释分区组织。
- 不能用 `fetch` / `XMLHttpRequest` 读本地文件。导入备份走 `FileReader`，导出走 `Blob` + `URL.createObjectURL`。
- 字体不能外链文件（Chrome 对 `@font-face` 走 CORS，file:// 下会被判跨源）。所以 `fonts.css` 里是 base64 data URI。
- 零外部请求是一条已验证的性质（`performance.getEntriesByType('resource')` 只有本地三个文件）。不要为了方便引入任何 CDN。

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
- 写操作的固定节奏：**`snapshot()` → 改 state → `save()` → `renderAll()`**。`snapshot()` 必须在修改前调用（它存的是 `JSON.stringify(state)`）。批量操作（如 `自动排程`）只在最外层 snapshot 一次，内部调用传 `quiet` 跳过 save/render。
- `state.ui.date` 在启动时无条件重置为今天，导入备份时也是。

### 数据模型的四条不变量

1. **任务是扁平列表**，父子关系只靠 `parentId`，且**只允许一层**。`childrenOf()` / `isParent()` 派生。
2. **有子任务的父任务不可排程**。`place()` 对 parent 直接返回 false，保存时若父任务刚获得子任务会撤下它已有的 block。父任务的显示时长 `taskMins()` = 子任务之和（`t.minutes` 字段保留为"计划总时长"，用于拆分界面的"剩余/超出"提示）。
3. **一个任务最多一个 block**（`blockOf()` 用 `find`）。跨日程安排靠 block 上的 `date` 字段，不是多条记录。
4. **block 必须完整落在某个 slot 内且互不重叠**。这条由 `findPlacement()` 保证，不要绕过它直接往 `state.blocks` 里塞。

`slots`（可用时间段）在每次增删后调用 `mergeSlots(date)` 合并重叠/相邻区间，所以 slot 的 id 会变，不要长期缓存。

### 排程算法

全部时间用「当天 0 点起的分钟数」表示（0–1440），日期用 `YYYY-MM-DD` 字符串（`keyOf` / `dateOf` / `shiftKey`）。

- `freeIntervals(dk, ignoreId, base)` — slots 减去 blocks，得到空闲区间。`base` 传 `[{s:0,e:1440}]` 可无视可用时间（"仍要放入"用）。
- `findPlacement(dk, dur, desired, ignoreId, anywhere, floor)` — 返回**离 desired 最近的合法起点**，放不下返回 `null`。这是唯一的落位入口。
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

要点：移动超过 5px 才 `live = true`（否则算点击）；`drag.result` 在 move 阶段算好，`pointerup` 只负责提交；触屏上 `paint` 直接放弃（留给页面滚动），`new` 只从 `.grip` 起手。

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
