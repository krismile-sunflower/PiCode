# DESIGN.md — PiCode

> 面向 AI 编码代理的设计系统文档。把本文件放在仓库里，任何代理据此生成与
> PiCode 观感一致的界面。规范格式参考 Google Stitch 的 DESIGN.md 九段结构。
> 所有数值来源于 `src/styles/tokens.css`（唯一事实来源），Tailwind 语义工具类
> 映射见 `src/tailwind.css` 的 `@theme inline`。
>
> **本版为 2026-09-29 的视觉语言重写。** 上一版描述的是「玻璃拟态 + 工程网格」，
> 已整体作废。若你看到旧版留下的 `backdrop-blur`、`bg-glass`、画布网格、
> `uppercase` 微标签或卡片 `shadow-sm`，那是遗漏，不是规范。

## 1. 视觉主题与氛围

- **主题**：桌面端 AI 编程工作台。暗色优先（默认暗色，浅色为完整第二主题）。
- **风格**：扁平、克制、靠「底色差 + 1px 分隔线 + 文字灰度」表达层级。
  参考系是 Linear / Raycast 那一类工具，不是营销落地页。
- **情绪**：安静、精确、不喧哗。界面里**没有**装饰性纹理、发光、渐变、
  毛玻璃——所有视觉重量都由内容和留白承担。
- **密度**：中高密度。字号 11–13px 为主，行高 1.5–1.65，单行省略是常态。
- **圆角语言**：三档。控件 6px、输入框与按钮 8px、卡片与浮层 12px。
  圆形仅用于状态点、开关、pill 徽章。

## 2. 色彩调色板与角色

所有颜色经 `@theme inline` 映射为 Tailwind 工具类，**禁止裸 hex**，一律用
语义工具类或 `var(--…)` / `color-mix()`。唯一的例外是遮罩黑
（`rgba(3,5,9,…)` / `rgba(4,6,10,…)`）。

### 底色阶梯 —— 只有三层

| 工具类 | 变量 | 暗色 | 浅色 | 角色 |
|---|---|---|---|---|
| `bg-solid` `bg-canvas` `bg-sidebar` | `--bg-app` | `#0a0b0e` | `#fbfbfa` | 应用最底色。**画布、侧栏、body 是同一个平面**，靠 1px 分隔线区分 |
| `bg-panel` | `--bg-surface` | `#111318` | `#ffffff` | 面板、卡片、输入框、工具卡 |
| `bg-elevated` `bg-frosted` | `--bg-overlay` | `#181a20` | `#ffffff` | 下拉、弹窗、命令面板、toast |
| `bg-muted` | `--bg-muted` | `#1a1c22` | `#f2f2f0` | 次级按钮底、代码内联底、计数徽章 |

### 文字阶梯

| 工具类 | 暗色 | 浅色 | 角色 |
|---|---|---|---|
| `text-primary` | `#f7f8f8` | `#16181d` | 正文、标题 |
| `text-secondary` | `#b0b7c4` | `#5b6273` | 次要文字、说明 |
| `text-dim` | `#7e8798` | `#858c9c` | 标签、占位、meta |
| `text-ghost` | `#545c6a` | `#b6bcc7` | 最弱层级（序号、计数） |

### 强调色 —— 只允许出现在四处

`--accent: #7b87f0`（浅色 `#5968d7`）/ `--accent-hover` / `--accent-strong`（主按钮底）/
`--accent-text`（强调色文字）/ `--accent-subtle`（12% 低饱和底）。

允许出现的**唯一**四处：

1. 主按钮底色（`bg-accent-strong`）
2. 导航激活态：`bg-accent-subtle` + 左侧 2px `bg-accent` 竖条
3. `:focus-visible` 焦点环（`outline-accent`）
4. 链接文字（`text-accent-text`）

**其余一律禁止**：卡片 hover 描边不用 accent、hover 底色不用 accent、
用户气泡不用 accent、工具卡底色不用 accent、`--accent-glow` 恒为透明、
禁止任何 accent 光晕/投影。颜色只用来表达**状态**（运行中 / 成功 / 警告 / 错误），
不用来表达「重点」。

### 状态色

`text-success #3fbf8f` / `text-warning #e0aa4e` / `text-error #f0606f`。
仅用于状态语义，不做装饰，不做区块底色（低饱和 `color-mix(…, 6%)` 的提示条除外）。

### 描边 —— 两个语义

| 工具类 | 暗色 | 浅色 | 角色 |
|---|---|---|---|
| `border-divider` | 6% 白 | 7% 黑 | **结构分隔**：侧栏与画布之间、列表行之间、分区之间 |
| `border-line` | 8% 白 | 10% 黑 | **控件轮廓**：卡片、输入框、按钮 |
| `border-line-hover` | 14% 白 | 18% 黑 | hover / focus 时的轮廓 |
| `border-line-bright` | 22% 白 | 28% 黑 | 需要明确边界时（如终端类工具卡） |

## 3. 排版规则

- 字族：`font-sans` = 系统栈（PingFang SC / Segoe UI / Microsoft YaHei）；
  `font-mono` = Cascadia Mono / ui-monospace。路径、代码、token 数、时间戳
  一律 `font-mono` + `tabular-nums`。
- **字重只有两档：400 和 500。** 禁止 600 及以上，禁止 `font-bold` /
  `font-semibold`。层级由**字号 + 灰度**表达，不由粗细表达。
- **字号只有五档**（含对应工具类）：

| 档位 | 值 | 工具类 | 用途 |
|---|---|---|---|
| meta | 11px | `text-meta` | 计数、tag、meta 行、时间戳 |
| secondary | 12px | `text-label` | 标签、说明、次级按钮文字 |
| body | 13px | `text-ui` | 正文、消息、控件、列表行 |
| section | 15px | `text-section` | 区块标题、Markdown h1 |
| page | 22px | `text-page` | 页面标题（`pane-header h2`）、空态标题 |

- **禁止 letter-spacing。** 字距恒为 0。层级绝不通过收紧或拉开字距表达。
- **禁止 `uppercase`。** 界面里不出现全大写微标签（eyebrow）。需要分组标题时
  用 12px `text-dim` 的普通句子。
- 中文为主的界面：不要用 italic 做强调（Markdown `em` 除外）；数字宽度用
  `tabular-nums` 保持对齐。

## 4. 组件样式

- **按钮**：主按钮 `bg-accent-strong text-white`，hover 提亮至 `accent-hover`；
  次按钮 `bg-muted border-line`；幽灵按钮（header / 列表行内）`border-transparent`
  + `hover:bg-glass-hover`，**默认不显示边框**。危险动作只变色不换底。
  所有按钮 `disabled: opacity-… + cursor-not-allowed`。
  高频复合按钮沉淀在 `src/styles/ui.css`（`settings-action-btn`、`catalog-action`、
  `icon-btn`、`pane-close`），直接用语义类。
- **输入框**：`settings-text-input` = `bg-muted border-line rounded-[8px]`，
  focus 时 `border-accent`（**1px 换色，不加外发光环**）。
- **卡片**：`bg-panel border border-line rounded-[12px] p-4`，**无阴影**。
  flush 变体（`pane-section flush`）去掉外框用于列表通栏。
- **列表行优先于卡片**：一组同类条目（会话、文件、模型、扩展）用通栏行 +
  `border-b border-divider` 分隔，不要每条都包一个带边框的卡片。
- **导航侧栏激活态**：`bg-accent-subtle` + 左侧 2px `bg-accent` 竖条。
- **消息**：用户消息右侧对齐、`bg-user-bubble`（**中性灰，不是彩色气泡**）；
  助手消息左侧对齐、无底色。工具调用卡片 `bg-tool`（2.8% 白）+ `border-line`，
  运行中才用 `border-accent`；可折叠，状态 pill 11px。
- **浮层**（下拉/命令面板/toast）：`bg-elevated` + `border-line` + `shadow-lg`。
  入场动画统一为 150ms opacity + 2px 位移（`paletteEnter` / `toastEnter` /
  `contextMenuEnter`），**不做缩放、不做弹跳**。
- **状态点**：5–7px 圆点。运行中用 `workbenchPulse`（1.4s 透明度呼吸）。
  **这是全项目唯一允许的循环动画**——不加光环、不加 box-shadow。
- **骨架屏**：静态 `bg-muted` 色块。**禁止 shimmer 流光渐变**。
- 图标：**只用 `lucide-react`**（stroke 风格、24 viewBox、`strokeWidth 2`），
  默认 `size={16}`，行内小图标 11–14px；实心方块（停止键）用
  `<Square className="fill-current" />`。
- **图标必须是 flex 容器的直接子元素。** 不要把图标再包一层 `<span>`：
  行内 span 的盒高由行盒决定（≈20px）而不是 SVG 的 16px，`items-center`
  居中这个虚高的盒子会让图标相对文字**上浮约 2px**。同理，
  `[&>span]:hidden` 这类「窄屏只留图标」的写法会连图标一起隐藏掉。
  - 对：`<button className="inline-flex items-center gap-[5px]"><Plus size={16} /><span>命令</span></button>`
  - 错：`<button className="inline-flex items-center gap-[5px]"><span><Plus size={16} /></span><span>命令</span></button>`
  - 只有在**正文行内**（非 flex 子项）配图标时才需要 `inline-block align-[-1px]` 手动校正。

## 5. 布局原则

- 三栏壳：会话侧栏（左，`--sidebar-width: 288px`，240–360 可拖）→ 主区 →
  文件栏（右，`--file-sidebar-width: 300px`，240–420 可拖，可整体收起）。
  侧栏与画布**同底色**，靠 `border-r border-divider` 区分；分隔条 4px，
  hover 出现 1px accent 线。
- 顶栏 52px（`--header-height`，≤720px 时同值），**纯色**，底部 1px
  `border-b border-line`。**不使用 backdrop-blur**。滚动区顶部 padding 用
  `calc(var(--header-height) + …)` 让出空间。
- 内容列：`--content-max-width` 与 `--composer-max-width` 均为 720px，
  聊天列水平居中（`padding: … max(20px, calc((100% - var)/2)) …`）。
- 设置/定制页：`pane-layout` = 172px 导航轨 + 自适应内容列
  （`max-w-[1120px]` 居中），间距 22px。
- 间距刻度沿用 Tailwind 4px 网格（0.5 步进）；卡片内边距 13–16px。
- **空态（欢迎页）**：只允许三层——一行 22px 标题、一行最多 3 个入口 chip、
  一行 `Ctrl+/ 全部快捷键`；内容在可用区域内**垂直居中**（`flex-1` +
  `place-items-center`）。
  **禁止**：logo/图标（侧栏左上角已有同一个，重复）、说明段落、入口卡片
  （用 chip 不用卡片）、能力提示行、大写 eyebrow、巨型标题、背景网格、
  径向光晕、编号与箭头装饰、成排的快捷键胶囊。
  一切功能提示统一进 `ShortcutsHelp`（`Ctrl+/` 唤起），**不在空态里重复**——
  重复提示是空态显得累赘的首要原因。
- z-index 梯子：1–40 内容/吸顶 → 120–200 侧栏 → 300–310 抽屉 → 500–510
  命令面板 → 620 Onboarding → 800 对话框 → 1000 toast → 1100 右键菜单。

## 6. 深度与层级

| 层级 | 工具类 | 暗色值 |
|---|---|---|
| 卡片 / 面板 | 无阴影 | — |
| 浮层（下拉、toast） | `shadow-md` | `0 8px 24px rgba(0,0,0,.36)` |
| 模态浮层 | `shadow-lg` | `0 16px 48px rgba(0,0,0,.48)` |

**深度只靠两件事：底色阶 + 描边。** 卡片永不加阴影，`shadow-inset` 恒为透明
（不模拟顶部内高光）。浮层是唯一会投影的东西。禁止品牌光晕
（`shadow-[0_7px_16px_var(--accent-glow)]` 这类写法已作废）。
遮罩层（modal scrim）允许保留 `backdrop-filter: blur(3–6px)`——它是功能性
聚焦手段，不是装饰；但顶栏、输入区、侧栏**一律不得**使用毛玻璃。

## 7. Do's and Don'ts

**Do**
- 颜色只用语义工具类（`bg-panel`、`border-divider`、`text-dim`…）或 `var(--…)`。
- 用底色差和留白分组；需要边界时用 1px `border-divider`。
- 图标只用 `lucide-react`；新图标在 [lucide.dev](https://lucide.dev) 选型。
- 交互动效时长用 token：`duration-[var(--duration-fast)]`（120ms）/
  `--duration`（150ms）/`--duration-slow`（200ms），缓动 `ease-(--ease)`。
- 新动画先在 `tailwind.css` 顶层登记 `@keyframes`，markup 用
  `animate-[name_…]`，且位移不超过 2px。
- 状态样式优先用变体：`hover:`、`focus-within:`、`disabled:`、
  `aria-expanded:`、`data-[status=新增]:`、`group-hover:`、`open:`。
- 复合样式第二次复用时提升进 `ui.css`（`@apply` 编写）。

**Don't**
- ❌ 画布网格、噪点、任何 `background-image` 纹理（代码块底色除外）。
- ❌ 毛玻璃 / `backdrop-blur`（modal scrim 除外）。
- ❌ 径向光晕、`filter: blur()` 光斑、品牌 glow 投影。
- ❌ 渐变（`linear-gradient` / `radial-gradient`），骨架 shimmer 尤甚。
- ❌ `uppercase`、`tracking-[…]`、字重 ≥600。
- ❌ 卡片 `shadow-sm` / `shadow-md`。
- ❌ 强调色出现在上述四处之外。
- ❌ 界面出现任何 emoji 或「字符当图标」（★ ▸ › ✓ ⌘ ↑↓ 等）——
  `pnpm check` 里的 `check-no-emoji` 会拦截。键盘提示用文字
  （`Ctrl+K`、`Shift+Enter`）或 lucide 箭头图标。
- ❌ 裸 hex/rgba 直接写进 className（遮罩黑除外）。
- ❌ 新建按页面命名的 CSS 文件或往 `styles/` 加组件规则；样式写进 markup。
- ❌ 为浅色主题复制一套样式；主题切换由 `data-theme` + token 自动完成。
- ❌ 绕过 z-index 梯子或 token 时长另写魔数。
- ❌ 用外部图标库、图标字体或内联 `<svg>` 手绘图标。

## 8. 响应式行为

自定义断点（`@theme`）：`compact 720px`、`narrow 960px`、`wide 1100px`，
变体写作 `max-compact:` / `max-narrow:` / `max-wide:`（桌面优先，向下收窄）。

- ≤960px：文件栏从侧栏变为右侧抽屉（fixed，86vw 宽 + 遮罩），右侧分隔条
  隐藏；顶栏隐藏工作区路径与状态文字；会话侧栏骨架不变。
- ≤720px：会话侧栏也变为左侧抽屉（88vw + 遮罩）；头部只留汉堡按钮 + 模型
  下拉 + 统计；消息列收窄至 15px 边距；输入区图标按钮只显示图标；
  所有 pane-header 变纵向堆叠；kv 网格降为 1 列；多列入口卡降为单列。
- 触控目标 ≥28px；列表行 ≥31px。`prefers-reduced-motion` 下全局动画与过渡
  降级为 0.01ms（见 `tailwind.css` 基础层）。

## 9. 代理提示指南

在 PiCode 里生成或修改 UI 时：

1. 读 `src/styles/tokens.css` 拿色板，读 `src/tailwind.css` 拿
   `@theme inline` 映射与 keyframes，读 `src/styles/ui.css` 拿可复用语义类。
2. 样式写入 TSX `className`；需状态/伪元素时用 Tailwind 变体与
   `before:`/`after:`；只有 react-markdown/hljs/KaTeX 产物才进
   `content-renderer.css`。
3. 速查：底色 `bg-solid/canvas/sidebar → bg-panel → bg-elevated → bg-muted`；
   文字 `text-primary → secondary → dim → ghost`；
   描边 `border-divider`（结构）/ `border-line`（控件）/ `-hover` / `-bright`；
   强调 `bg-accent-strong` + `text-accent-text`（仅四处）。
4. 新增界面时先问：**这个元素去掉会不会影响功能？** 会 → 保留；不会 → 删掉。
   这一条能挡掉绝大多数装饰。
5. 示例提示词：「给设置页加一个『导出配置』按钮，样式与现有
   `settings-action-btn` 一致，放在 `pane-section-actions` 里，图标用
   lucide Download」。
6. 完成后运行 `pnpm check`（typecheck + 测试 + stylelint + emoji 扫描 +
   构建），全绿才算完成。
