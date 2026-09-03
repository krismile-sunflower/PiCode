# Contributing to PiCode

Everything needed to build, package and verify PiCode locally. Product
documentation lives in [README.md](README.md).

## Requirements

- Node.js 20+.
- pnpm 10+ (Corepack is recommended).
- Rust stable toolchain.
- Tauri v2 prerequisites for your platform.
- A working local Pi install on the build machine:

```bash
pi --version
```

The final installed app does not require the end user to start `pi` manually.

## Development

Install dependencies:

```bash
pnpm install
npm install --omit=dev --prefix ./src-tauri/extensions
```

Start the app in development:

```bash
pnpm tauri:dev
```

If Vite is already running on `127.0.0.1:1420`, reuse it:

```bash
pnpm tauri:dev:reuse
```

Useful frontend commands:

```bash
pnpm build
pnpm preview
pnpm typecheck
pnpm test
```

The frontend is a React 19 + TypeScript application built by Vite. `src/app`
contains the typed application controller/store, `src/components` contains the
workbench views, and `src/lib` owns the Tauri/API/transport contracts. pnpm is
the only package manager for the root frontend; the bundled legacy mirror
extension keeps its isolated npm install because Pi loads that resource as a
standalone package.

Useful backend check:

```bash
cargo check --manifest-path ./src-tauri/Cargo.toml
```

## Pi Runtime Packaging

Release builds vendor the build machine's installed `pi` runtime into Tauri resources. PiCode then launches the bundled Pi process in the background.

Platform resource directories:

- `src-tauri/binaries/windows-x64/`
- `src-tauri/binaries/macos-x64/`
- `src-tauri/binaries/macos-arm64/`
- `src-tauri/binaries/linux-x64/`

Each platform directory contains:

- `node` or `node.exe`
- `pi-package/`
- a small `pi` wrapper for manual debugging

Windows:

```powershell
.\scripts\vendor-pi-sidecar-windows.ps1
```

macOS/Linux:

```bash
./scripts/vendor-pi-sidecar-unix.sh
```

If auto-detection cannot find the right Node or Pi package on macOS/Linux, override them explicitly:

```bash
NODE_BIN="$(command -v node)" PI_PACKAGE="$(npm root -g)/@earendil-works/pi-coding-agent" ./scripts/vendor-pi-sidecar-unix.sh
```

Development override:

```bash
PI_DESKTOP_CLI=/path/to/pi pnpm tauri:dev
```

Legacy mirror/WebSocket transport is still available for compatibility:

```bash
PI_DESKTOP_TRANSPORT=mirror pnpm tauri:dev
```

## Release Builds

Windows:

```powershell
.\scripts\build-release.ps1 -Debug
```

With smoke test:

```powershell
.\scripts\build-release.ps1 -Smoke -Debug
```

macOS/Linux:

```bash
./scripts/build-release.sh --debug
```

Manual debug build:

```bash
pnpm exec tauri build --debug
```

Generated installers use the `PiCode` product name. On Windows, if `target/debug/PiCode.exe` is currently running, close the app before rebuilding because Windows will not overwrite a running executable.

## Extensions

The Extensions page reads Pi extension examples from:

1. the installed system Pi package
2. the bundled Pi package under `src-tauri/binaries/<platform>/pi-package/examples/extensions`

Installed extensions are copied into:

```text
~/.pi/agent/extensions
```

Directory extensions with `package.json` run:

```bash
npm install --omit=dev
```

New Pi sessions pick up installed extensions, so restart Pi or open a new project session after installing an extension.

## Verification

Recommended checks:

```powershell
pnpm build
cargo check --manifest-path .\src-tauri\Cargo.toml
.\scripts\smoke-pi-tau.ps1 -ProjectPath D:\myproduction\PiCode -Port 3991 -TimeoutSeconds 45
pnpm exec tauri build --debug
```

The smoke script checks native Pi RPC by default. Add `-Mirror` to run the legacy Tau mirror health check as well.

macOS/Linux should run the equivalent build script on the target platform:

```bash
./scripts/build-release.sh --debug
```

## Troubleshooting

If Pi does not start:

- Confirm `pi --version` works on the build machine.
- Re-run the vendor script for your platform.
- Check app logs under the platform config directory, for example `pi-studio/logs` (the legacy directory is retained so existing settings continue to work).
- In development, set `PI_DESKTOP_CLI` to a known working Pi executable.

If sessions do not appear:

- Confirm files exist under `~/.pi/agent/sessions`.
- Click the session refresh button.
- Start or restart Pi from PiCode so the native RPC session can refresh live state.

If Windows debug build cannot overwrite `PiCode.exe`:

- Close the running PiCode window.
- Check Task Manager for `PiCode.exe`.
- Run `pnpm exec tauri build --debug` again.

## Notes

PiCode is not presented as the Tau project itself. It references and adapts Tau's browser UI for a standalone desktop experience, while the desktop app talks to Pi through native RPC by default. The public desktop product name is `PiCode`.

## Attribution

This project references [`deflating/tau`](https://github.com/deflating/tau) for the browser-based Pi UI and mirror workflow. Upstream Tau remains a separate project; PiCode adapts those ideas into a Tauri desktop client with bundled Pi startup, native RPC transport, local session management, and extension installation.

