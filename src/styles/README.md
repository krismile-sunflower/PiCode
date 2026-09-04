# src/styles — CSS 模块指南

拆分自原 `workbench.css`（2887 行）。拆分为**纯机械操作**（叶子规则与拆分前
基线 tag `pre-css-split` 逐条等价），后续清理与工具类迁移均有构建验证。

## 模块边界

| 文件 | 职责 | 对应组件域 |
|------|------|-----------|
| `tokens.css` | 深浅主题设计 token、代码配色 | 全局变量，只能在这里定义 |
| `tailwind.css @layer base` | 元素默认、focus、kbd、滚动条、tabular-nums、reduced-motion 兜底 | 全局元素 |
| `shell.css` | `.app-layout` / `.main` / panel resizer | App 布局骨架 |
| `sidebar.css` | 会话侧栏全部 + 底部导航 + 新会话菜单 + 空状态 | `Sidebar.tsx` |
| `header.css` | 顶栏、模型下拉、上下文用量浮层 | `WorkbenchChrome.tsx` Header |
| `panes.css` | 工作台页面壳、设置/供应商、扩展目录、提示模板 | `Views.tsx` |
| `chat.css` | 消息区、composer、slash 菜单、附件、@提及 | `WorkbenchChrome.tsx` Composer、`MessageList.tsx` |
| `file-panel.css` | 文件树、预览、终端记录、计划展示 | `FileSidebar.tsx` |
| `projects.css` | 项目启动器 | `Views.tsx` Launcher |
| `overlays.css` | 命令面板、toast、对话框、权限卡、Onboarding、自动化 | 各浮层 |
| `plan.css` | 计划模式工作流 | 计划 UI |
| `signal.css` | **刻意的后期覆盖块** | 保持最后导入 |
| `diff-review.css` | DiffView、变更审阅面板 | `DiffView.tsx`、审阅 UI |
| `content.css` | 消息内容渲染（Markdown/代码块/工具卡/思考块） | `Markdown.tsx`、`MessageList.tsx` |

导入顺序在 `../tailwind.css` 中维护，**signal.css 必须最后**。

## 约定

1. **命名**：`.域-元素`（如 `.session-item`、`.composer-shell`），状态用
   `.active/.collapsed/.danger` 等单词后缀。动态拼接类
   （`plan-state-${phase}`、`diff-${kind}`、`task-surface-*`、
   `welcome-starter-${id}`）改动前先 grep 模板字符串。
2. **token 纪律**：禁止在规则里写裸 hex/rgba 颜色（`tokens.css` 定义处和
   遮罩层 `rgba(4,6,10,…)` 除外）；一律用 `var(--…)` 或
   `color-mix(in srgb, var(--…))`。
3. **z-index 刻度**（`tailwind.css` 的基础层注释）：1–40 内容/吸顶 → 120–200 侧栏 →
   300–310 抽屉 → 500–510 命令面板 → 620 Onboarding → 800 对话框 →
   1000 toast → 1100 临时右键菜单。新浮层必须落在这个梯子上。
4. **工具类 vs 语义类分工**：
   - 一次性布局、简单间距 → TSX 里直接写 Tailwind 工具类
   - 复用 ≥2 处的复合组件、状态样式、主题相关样式 → CSS 语义类
   - 出现复制粘贴第三遍的工具类组合 → 沉淀为语义类
5. **动画**：新动画必须同时登记进 `tailwind.css` 的 `prefers-reduced-motion`
   兜底块覆盖范围（兜底是全局的，一般无需额外处理，但不要用
   `animation-duration` 以外的手段绕过它）。

## 验证工具

- `pnpm check`：typecheck + 测试 + 构建必须全绿。
- `pnpm lint:css`：stylelint（禁止未知 at-rule 误报、裸颜色、未知
  `var()` 引用）。接入方式见 `.stylelintrc.json`。
- 涉及级联顺序的大改：先构建并按叶子规则比对编译产物
  （参考 `pre-css-split` 流程），不一致立即回退。
