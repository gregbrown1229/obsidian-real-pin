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
npm install         # also installs the pre-push git hook (core.hooksPath)
npm run dev         # esbuild watch → main.js
npm run build       # typecheck + production bundle
npm run check       # the full gate: validate + lint + typecheck + test
```

### Publishing-rule enforcement

The Obsidian publishing rules are enforced mechanically at three points, so a
non-compliant change can't reach a release:

- **`npm run lint`** runs the official [`eslint-plugin-obsidianmd`](https://github.com/obsidianmd/eslint-plugin)
  recommended set. This owns the manifest-field rules (`validate-manifest`) and,
  critically, **`no-unsupported-api`** — it reads `manifest.json`'s `minAppVersion`
  and flags any Obsidian API newer than it (e.g. `setDestructive()`, which needs
  1.13.0, under `minAppVersion 1.4.0`).
- **`npm run validate`** ([`scripts/validate-plugin.mjs`](scripts/validate-plugin.mjs))
  owns the cross-file/release rules ESLint can't see: `manifest.json` ↔
  `package.json` ↔ `versions.json` version consistency, the `versions.json` ↔
  `minAppVersion` mapping, required `README.md`/`LICENSE`, and — in release mode
  (`--release-tag <tag>`) — that the git tag equals `manifest.version` and is
  present in `versions.json`.
- **Where they run:** a **pre-push git hook** ([`.githooks/pre-push`](.githooks/pre-push))
  runs `npm run check` and validates any tag being pushed; **CI**
  ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs it on every PR and
  push to `main`; and the **release workflow** re-runs it (plus the release-tag
  check) before building, so a botched tag/version never produces a release.

### Cutting a release

```bash
npm version patch        # bumps manifest/package/versions, validates, commits, tags (no 'v')
git push --follow-tags   # pre-push hook gates it → release workflow builds an attested draft
```

Then publish the draft release. (One gap tooling can't close: creating a release
by hand in the GitHub UI bypasses this pipeline — always release via tag push.)

## How it works

The plugin wraps the `workspace:close` command's `checkCallback` using [`monkey-around`](https://github.com/pjeby/monkey-around). When the wrapped callback runs and the active leaf is pinned, it either shows a `ConfirmCloseModal` (and only calls the original close on confirmation) or blocks the close outright, depending on the setting — which is read live on each invocation. The wrapper is registered via `this.register(...)`, so disabling the plugin restores Obsidian's original behavior cleanly.

## License

MIT
