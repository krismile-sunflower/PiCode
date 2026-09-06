# src/styles — CSS 架构指南

UI 样式以 **Tailwind CSS v4 工具类为主**：组件样式直接写在 TSX 的 `className` 里，
本目录只保留四类无法或不宜内联的 CSS。新增样式时优先写工具类，不要往这里加规则。

## 文件清单

| 文件 | 职责 |
|------|------|
| `tokens.css` | 深浅主题设计 token、代码配色。全局 CSS 变量只能在这里定义 |
| `ui.css` | 跨组件复用的语义原语（`icon-btn`、`settings-action-btn`、`pane-section`、`catalog-*` 等），全部用 `@apply` 编写 |
| `app-state.css` | markup 工具类无法表达的全局状态与元素内部伪元素：`body.is-resizing`、resizer 悬停条、`<progress>` 内部条 |
| `content-renderer.css` | 针对 react-markdown / highlight.js / KaTeX 产物的后代选择器（这些节点没有可控类名）；`body.hide-thinking` 钩子 |

导入顺序在 `../tailwind.css` 中维护。

## 约定

1. **工具类优先**：一次性布局、间距、颜色、状态一律在 TSX 里直接写 Tailwind
   工具类（含 `hover:`、`data-[status=*]:`、`group-hover:`、`max-narrow:` 等变体）。
2. **语义类提升门槛**：同一段复合样式在 ≥2 个文件（或同一文件大量重复）出现时，
   才沉淀进 `ui.css`，且必须用 `@apply` 编写；禁止再新建按页面命名的 CSS 文件。
3. **命名**：语义类用 `.域-元素`（如 `.session-item`）或沿用 Tailwind 语义
   （`.settings-action-btn`）。动态拼接类（`plan-state-${phase}`、`diff-${kind}`）
   改动前先 grep 模板字符串。
4. **token 纪律**：禁止在规则里写裸 hex/rgba 颜色（`tokens.css` 定义处和
   遮罩层 `rgba(3,5,9,…)` 除外）；一律用 `var(--…)`、`color-mix()` 或
   `@theme inline` 映射出的语义工具类（`bg-panel`、`text-dim`、`border-line`）。
5. **z-index 刻度**：1–40 内容/吸顶，120–200 侧栏，300–310 抽屉，500–510
   命令面板，620 Onboarding，800 对话框，1000 toast，1100 临时右键菜单。
   新浮层必须落在这个梯子上。
6. **断点**：项目自定义 `--breakpoint-compact: 720px` / `--breakpoint-narrow:
   960px` / `--breakpoint-wide: 1100px`（`tailwind.css` 的 `@theme` 内），
   工具类变体写作 `max-compact:`、`max-narrow:`、`max-wide:`。
7. **动画**：keyframes 统一登记在 `tailwind.css` 顶层；markup 里用
   `animate-[name_duration_easing]` 任意值引用。全局 `prefers-reduced-motion`
   兜底会自动降级。
8. **图标**：一律使用 `lucide-react` 组件（默认 `size={16}`）；界面禁止 emoji
   和「字符当图标」（`scripts/check-no-emoji.mjs` 会在 `pnpm check` 里拦截）。

## 验证工具

- `pnpm check`：typecheck + 测试 + stylelint + emoji 扫描 + 构建必须全绿。
- `pnpm lint:css`：stylelint（禁止未知 at-rule 误报、裸颜色、未知 `var()` 引用）。
  接入方式见 `.stylelintrc.json`。
