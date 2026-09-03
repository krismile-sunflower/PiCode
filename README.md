# PiCode

**跨平台的 AI 编程 Agent 指挥台 —— 任意模型、隔离并行、先审后落地。**

PiCode is a desktop workbench for [Pi](https://github.com/earendil-works/pi-coding-agent).
It is not "Pi with a window around it": it is where you decide which model does
which job, run several tasks at once without them colliding, and review every
change before it lands.

中文文档: [README.zh-CN.md](README.zh-CN.md) · 构建与打包: [CONTRIBUTING.md](CONTRIBUTING.md)

## Why PiCode

**Any model, routed by task.** `models.json` accepts any OpenAI-compatible,
Anthropic or Google endpoint, and Settings → 模型 lets you send planning,
coding and search to *different* models. A single-vendor client cannot do this.

**Isolated, parallel work.** Start a session against a detached git worktree
instead of your working tree. Two tasks on one repository stop fighting over
the same files, and each isolated copy runs its own Pi process — so they run at
the same time and you switch between them from the sidebar.

**Review before it lands.** `⌘⇧G` opens a full-width review panel: coloured
diffs with line numbers, four comparison scopes (unstaged / staged / since
HEAD / since a base branch / since this turn started), hunk-level stage and
revert, and per-line notes that you hand back to Pi as one instruction.

**The same app on Windows, macOS and Linux.** One bundled runtime mechanism,
one feature set, no second-class platform.

## What you get

- **Plan → Review → Build**: a genuinely read-only planning mode, enforced by a
  bundled extension, then step-by-step execution you can watch.
- **Permission control you can trust**: ask / read-only / full-access, with
  "allow for this session" scoped to *one session and one command family* —
  and every decision written to an audit log you can open from Settings.
- **Session management**: browse local Pi sessions, continue any of them, fork a
  conversation from any message, rewind, regenerate, or delete a message and its
  descendants.
- **`@` file mentions** that send the file's *contents*, not its path.
- **Cost and usage**, broken down per model and exportable as CSV.
- **`AGENTS.md` as a first-class artifact**, editable in-app.
- **Automations**: scheduled prompts that run on their own and land in your
  session history.

## Getting started

Install the app, open a project, and answer the three questions the first-run
guide asks: which model, how much authority Pi has, and whether it edits your
working tree or an isolated copy. Everything else is discoverable from `⌘K`
(command palette) and `⌘/` (all keyboard shortcuts).

Requirements for *running* a release build: none beyond the installer — the Pi
runtime is bundled. Requirements for *building from source* are in
[CONTRIBUTING.md](CONTRIBUTING.md).

## Sessions

PiCode reads Pi session files from:

```text
~/.pi/agent/sessions
```

The sidebar groups sessions by project folder. Selecting a session loads the underlying JSONL file directly and makes that session the current chat target. Sending a new message after selecting a session appends to that selected session instead of opening a disconnected read-only history view.

No-folder mode uses an app-owned directory and is useful when the user wants to chat without selecting a project folder.

## Attribution

This project references [`deflating/tau`](https://github.com/deflating/tau) for the browser-based Pi UI and mirror workflow. Upstream Tau remains a separate project; PiCode adapts those ideas into a Tauri desktop client with bundled Pi startup, native RPC transport, local session management, and extension installation.

