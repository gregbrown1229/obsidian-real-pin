# Real Pin

Makes a pinned tab's pin actually mean something for the keyboard.

Obsidian lets you pin a tab, but pinning doesn't stop the **Close current tab** command (`Cmd+W` / `Ctrl+W` by default) from closing it — one stray keystroke and the tab is gone. **Real Pin** intercepts that command: when the active tab is pinned, it pops a confirmation dialog instead of closing immediately. Confirm to close, cancel (or `Esc`) to keep it.

Because it hooks the command rather than a specific key, it works no matter which hotkey you've bound to **Close current tab**, and also covers running the command from the command palette.

## Settings

**Confirm before closing a pinned tab** (default: on)

- **On** — closing a pinned tab via a hotkey/command pops the confirmation dialog. Confirm to close, cancel (or `Esc`) to keep it.
- **Off** — closing a pinned tab that way is blocked entirely: no dialog, the tab never closes. Unpin it first to close it by keyboard.

The toggle takes effect immediately — no reload needed.

## Scope

- ✅ `Cmd+W` / `Ctrl+W` and any custom hotkey bound to **Close current tab**
- ✅ Running **Close current tab** from the command palette
- ❌ Middle-click or right-click → **Close** on a tab (these bypass the command — by design)
- ❌ **Close others** / **Close tab group**

## Install (manual)

1. Build or download `main.js` and `manifest.json`.
2. Copy both into `<your-vault>/.obsidian/plugins/real-pin/`.
3. In Obsidian, open **Settings → Community plugins**, reload plugins, and enable **Real Pin**.

## Develop

```bash
npm install
npm run dev    # esbuild watch → main.js
npm run build  # typecheck + production bundle
```

## How it works

The plugin wraps the `workspace:close` command's `checkCallback` using [`monkey-around`](https://github.com/pjeby/monkey-around). When the wrapped callback runs and the active leaf is pinned, it either shows a `ConfirmCloseModal` (and only calls the original close on confirmation) or blocks the close outright, depending on the setting — which is read live on each invocation. The wrapper is registered via `this.register(...)`, so disabling the plugin restores Obsidian's original behavior cleanly.

## License

MIT
