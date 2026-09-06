# DESIGN.md — PiCode

> 面向 AI 编码代理的设计系统文档。把本文件放在仓库里，任何代理据此生成与
> PiCode 观感一致的界面。规范格式参考 Google Stitch 的 DESIGN.md 九段结构。
> 所有数值来源于 `src/styles/tokens.css`（唯一事实来源），Tailwind 语义工具类
> 映射见 `src/tailwind.css` 的 `@theme inline`。

## 1. 视觉主题与氛围

- **主题**：桌面端 AI 编程工作台。暗色优先（默认暗色，浅色为完整第二主题），
  玻璃拟态 + 「工程网格」质感：主画布带 32px 淡网格线，顶栏与浮层用半透明
  毛玻璃 + 高斯模糊。
- **情绪**：冷静、克制、专业工具感。低饱和的深蓝灰基底上，用一种长春花蓝
  （periwinkle）强调色驱动全部交互焦点；成功/警告/错误三色只用于状态语义。
- **密度**：中高密度。紧凑行高（消息 1.72、控件 1.3–1.55）、小字号
  （10–14px 为主）、单行省略是常态——这是一台「信息机器」，不是营销页。
- **圆角语言**：小圆角（控件 7–10px、卡片 10–12px、浮层 10–15px），圆形
  仅用于状态点、开关、pill 徽章。

## 2. 色彩调色板与角色

所有颜色经 `@theme inline` 映射为 Tailwind 工具类，**禁止裸 hex**，一律用
语义工具类或 `var(--…)` / `color-mix()`。

| 工具类 | 变量 | 暗色值 | 角色 |
|---|---|---|---|
| `bg-solid` | `--bg-solid` | `#0c0e12` | 应用最底色（body） |
| `bg-canvas` | `--bg-canvas` | `#10131a` | 主画布、工作区视图 |
| `bg-sidebar` | `--bg-sidebar` | `#0d1016` | 两侧栏 |
| `bg-panel` | `--bg-panel` | `#161a22` | 卡片/分区 |
| `bg-elevated` | `--bg-elevated` | `#1b202a` | 浮层、下拉、hover 提亮 |
| `bg-muted` | `--bg-muted` | `#242b37` | 输入框底、次级按钮、计数徽章 |
| `bg-glass` | `--bg-glass` | `rgba(255,255,255,.032)` | 玻璃控件底 |
| `bg-glass-hover` / `bg-glass-active` | — | — | 玻璃交互态 |
| `bg-frosted` | `--bg-frosted` | `#171b23` | 头部下拉/上下文浮层 |
| `text-primary` | `--text-primary` | `#f4f5f8` | 正文 |
| `text-secondary` | `--text-secondary` | `#acb2c1` | 次要文字 |
| `text-dim` | `--text-dim` | `#747d90` | 说明、占位、标签 |
| `text-ghost` | `--text-ghost` | `#4b5363` | 最弱层级（序号、meta） |
| `bg-accent` / `accent-hover` / `accent-strong` | `--accent*` | `#8793f8` 系 | 唯一强调色：焦点、主按钮、激活态 |
| `text-accent-text` / `bg-accent-subtle` | — | `#bbc2ff` / 13% | 强调色文字与低饱和底 |
| `bg-user-bubble` | `--user-bubble` | `#202744` | 用户消息气泡 |
| `text-success` `text-warning` `text-error` | `--success` 等 | `#43d39e` `#f1b955` `#ff6b7a` | 仅状态语义，不做装饰 |
| `border-line` / `line-hover` / `line-bright` | `--border*` | 7.5%→24% 白 | 三档描边 |

浅色主题为完整覆盖（`:root[data-theme="light"]`），暖纸底 `#f4f4f1` +
靛蓝强调 `#5968d7`。主题切换靠 `<html data-theme>`，工具类自动跟随，**不要
为浅色写单独的样式分支**（例外：`light:` 自定义变体可用于画布网格线）。

## 3. 排版规则

- 字族：`font-sans` = 系统栈（Segoe UI / PingFang SC / Microsoft YaHei）；
  `font-mono` = Cascadia Mono / ui-monospace。路径、代码、token 数、时间戳
  一律 `font-mono` + `tabular-nums`。
- 层级（暗色为默认）：

| 元素 | 规格 |
|---|---|
| 欢迎页 H1 | `clamp(32px, 4.2vw, 48px)`，weight 720，tracking -0.06em，行高 1.04 |
| 页面标题（pane-header h2） | 26px，weight 730，tracking -0.04em（≤720px 时 22px） |
| 会话标题 | 13px，weight 520（激活 660） |
| 正文/消息 | 14px，行高 1.72 |
| 卡片标题 | 12–13px，bold |
| 控件/按钮文字 | 10–12px，weight 620–650 |
| 分组标签（eyebrow） | 10px，bold，大写，tracking 0.1em，`text-dim` |
| meta/状态行 | 9–11px，`text-dim`/`text-ghost` |

- 中文为主的界面：不要用 italic 做强调（Markdown `em` 除外）；数字宽度用
  `tabular-nums` 保持对齐。

## 4. 组件样式

- **按钮**：主按钮 `bg-accent-strong text-white`，hover 提亮至 `accent-hover`；
  次按钮 `bg-muted border-line`；玻璃按钮 `bg-glass border-line`（header 区）；
  危险动作只变色不换底。所有按钮 `disabled: opacity-… + cursor-not-allowed`。
  高频复合按钮沉淀在 `src/styles/ui.css`（`settings-action-btn`、
  `catalog-action`、`icon-btn`、`pane-close`），直接用语义类。
- **输入框**：`settings-text-input` = `bg-muted border-line rounded-lg`，
  focus 时 `border-accent + 2px accent-subtle 光环`。
- **卡片**：`bg-panel border border-line rounded-[11px] p-4`；flush 变体
  （`pane-section flush`）去掉外框用于列表通栏。
- **导航侧栏激活态**：`bg-accent-subtle` + 左侧 2px `bg-accent` 竖条。
- **消息**：用户消息为右侧气泡（`bg-user-bubble`，圆角 12/12/3/12）；助手
  消息左侧 1px 分隔线 + 无底色；工具调用卡片 `bg-tool`（accent 6.5% 底），
  可折叠，状态 pill 9px。
- **浮层**（下拉/命令面板/toast）：`bg-elevated` 或 `bg-frosted` +
  `shadow-lg`，进入动画统一 `paletteEnter`/`toastEnter`/`contextMenuEnter`。
- **状态点**：6–7px 圆点；运行中用 `workbenchPulse` 呼吸动画。
- 图标：**只用 `lucide-react`**（stroke 风格、24 viewBox、`strokeWidth 2`），
  默认 `size={16}`，行内小图标 9–14px；实心方块（停止键）用
  `<Square className="fill-current" />`。

## 5. 布局原则

- 三栏壳：会话侧栏（左，`--sidebar-width: 288px`，240–360 可拖）→ 主区 →
  文件栏（右，`--file-sidebar-width: 300px`，240–420 可拖，可整体收起）。
  分隔条 4px，hover 出现 1px accent 线。
- 顶栏 60px（≤720px 时 54px），毛玻璃，绝对定位悬浮于滚动区之上；滚动区
  顶部 padding 用 `calc(var(--header-height) + …)` 让出空间。
- 内容列：`--content-max-width` 与 `--composer-max-width` 均为 760px，
  聊天列水平居中（`padding: … max(24px, calc((100% - var)/2)) …`）。
- 设置/定制页：`pane-layout` = 172px 导航轨 + 自适应内容列
  （`max-w-[1120px]` 居中），间距 22px。
- 间距刻度沿用 Tailwind 4px 网格（0.5 步进）；卡片内边距 13–16px。
- z-index 梯子：1–40 内容/吸顶 → 120–200 侧栏 → 300–310 抽屉 → 500–510
  命令面板 → 620 Onboarding → 800 对话框 → 1000 toast → 1100 右键菜单。

## 6. 深度与层级

| 层级 | 工具类 | 暗色值 |
|---|---|---|
| 卡片 | `shadow-sm` | `0 1px 2px rgba(2,4,8,.32)` |
| 悬浮卡/切换条 | `shadow-md` | `0 14px 34px rgba(2,4,8,.27)` |
| 模态浮层 | `shadow-lg` | `0 28px 72px rgba(2,4,8,.42)` |
| 顶部内高光 | `shadow-(--shadow-inset)` | `inset 0 1px 0 rgba(255,255,255,.045)` |

深度靠「底色阶 + 描边阶 + 阴影」三件事同时表达：越浮起的表面底色越亮、
描边越实、阴影越大。主操作按钮可叠加品牌光晕
`shadow-[0_7px_16px_var(--accent-glow)]`。毛玻璃（`backdrop-filter`）只用于
顶栏、输入区和全屏遮罩；浅色主题下强度不变。

## 7. Do's and Don'ts

**Do**
- 颜色只用语义工具类（`bg-panel`、`text-dim`…）或 `var(--…)`。
- 图标只用 `lucide-react`；新图标在 [lucide.dev](https://lucide.dev) 选型。
- 交互动效时长用 token：`duration-[var(--duration-fast)]`（120ms）/
  `--duration`（180ms）/`--duration-slow`（240ms），缓动 `ease-(--ease)`。
- 新动画先在 `tailwind.css` 顶层登记 `@keyframes`，markup 用
  `animate-[name_…]`。
- 状态样式优先用变体：`hover:`、`focus-within:`、`disabled:`、
  `aria-expanded:`、`data-[status=新增]:`、`group-hover:`、`open:`。
- 复合样式第二次复用时提升进 `ui.css`（`@apply` 编写）。

**Don't**
- ❌ 界面出现任何 emoji 或「字符当图标」（★ ▸ › ✓ ⌘ ↑↓ 等）——
  `pnpm check` 里的 `check-no-emoji` 会拦截。键盘提示用文字
  （`Ctrl+K`、`Shift+Enter`）或 lucide 箭头图标。
- ❌ 裸 hex/rgba 直接写进 className（遮罩黑 `rgba(3,5,9,…)` 除外）。
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
  下拉 + 统计；`--header-height` 降为 54px；消息列收窄至 15px 边距；输入区
  图标按钮只显示图标；所有 pane-header 变纵向堆叠；kv 网格降为 1 列。
- 触控目标 ≥28px；列表行 ≥31px。`prefers-reduced-motion` 下全局动画与过渡
  降级为 0.01ms（见 `tailwind.css` 基础层）。

## 9. 代理提示指南

在 PiCode 里生成或修改 UI 时：

1. 读 `src/styles/tokens.css` 拿色板，读 `src/tailwind.css` 拿
   `@theme inline` 映射与 keyframes，读 `src/styles/ui.css` 拿可复用语义类。
2. 样式写入 TSX `className`；需状态/伪元素时用 Tailwind 变体与
   `before:`/`after:`；只有 react-markdown/hljs/KaTeX 产物才进
   `content-renderer.css`。
3. 速查：底色 `bg-solid→bg-canvas→bg-sidebar→bg-panel→bg-elevated→bg-muted`；
   文字 `text-primary→secondary→dim→ghost`；描边 `border-line→line-hover→line-bright`；
   强调 `bg-accent(-strong/-subtle)` + `text-accent-text`。
4. 示例提示词：「给设置页加一个『导出配置』按钮，样式与现有
   settings-action-btn 一致，放在 pane-section-actions 里，图标用
   lucide Download」。
5. 完成后运行 `pnpm check`（typecheck + 测试 + stylelint + emoji 扫描 +
   构建），全绿才算完成。
