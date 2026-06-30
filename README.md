# Real Pin

Makes a pinned tab's pin actually mean something for the keyboard.

Obsidian lets you pin a tab, but pinning doesn't stop the **Close current tab** command (`Cmd+W` / `Ctrl+W` by default) from closing it — one stray keystroke and the tab is gone. **Real Pin** intercepts that command: when the active tab is pinned, it pops a confirmation dialog instead of closing immediately. Confirm to close, cancel (or `Esc`) to keep it.

Because it hooks the command rather than a specific key, it works no matter which hotkey you've bound to **Close current tab**, and also covers running the command from the command palette.

## Settings

**Confirm before closing a pinned tab** (default: on)

- **On** — closing a pinned tab via a hotkey/command pops the confirmation dialog. Confirm to close, cancel (or `Esc`) to keep it.
- **Off** — closing a pinned tab that way is blocked entirely: no dialog, the tab never closes. Unpin it first to close it by keyboard.

The toggle takes effect immediately — no reload needed.

**Compact pinned tabs** (default: off)

Shrinks every pinned tab to just its icon, so a row of pinned tabs reads as a compact icon strip.

- **No dependencies.** It keys on Obsidian's own pin indicator, so it's pure CSS — there's no per-tab JavaScript, no reliance on another plugin, and nothing to go out of sync.
- For a row of *distinct* icons, assign them with an icon plugin such as **[Iconize](https://github.com/FlorianWoelki/obsidian-iconize)**. A pinned tab without a custom icon simply shows Obsidian's default file icon.
- The title isn't lost: Obsidian still shows it as a hover tooltip and exposes it to screen readers via the tab's `aria-label`. The close “×” and right-click menu still work.
- Works in popped-out windows too. Takes effect immediately — no reload needed. Turning it off (or disabling Real Pin) restores every tab.
- Use the **Compact tab width** slider in settings to choose how narrow a compacted tab gets (it drives the `--real-pin-compact-tab-width` CSS variable, default `72px`). Obsidian grows tabs to fill the bar and won't size them to their content, so the width is a cap rather than a true shrink-to-fit.

## Tab groups (Chrome-style)

Organize tabs into named, colored, collapsible groups **inside the single tab bar** — like Google Chrome's tab groups — and save groups to reopen later.

Opt-in: turn on **Settings → Real Pin → Enable tab groups** (off by default).

- **Make a group** — run **New tab group from active tab**, or **Add active tab to group** (pick an existing group or create one). A colored chip appears in the tab bar before the group's tabs, which share a colored band.
- **Drag to group** — Obsidian already lets you drag a tab along the bar; drop it *inside* a group's run to add it, or drag a member *out* to remove it. (We read the native reorder and update membership — no custom drag layer.)
- **Collapse / expand** — click the group chip (collapsed shows just the chip; the member tabs hide).
- **Rename / recolor** — right-click the chip → **Edit name and color…** (nine Chrome colors).
- **Save & reopen** — right-click the chip → **Save group** (or the command). Saved groups live in the **Saved tab groups** sidebar panel (ribbon icon, or the **Open the saved tab groups panel** command); **Open** reopens every tab back into the current tab area, regrouped with the original name and color. A saved group stays in sync with its open group, like Chrome's saved groups.
- **Persists** — live groups are restored when you reopen the vault; saved groups persist until you delete them. Works in popped-out windows too. Turning the feature off (or disabling Real Pin) removes every chip and reverts every tab.

Because Obsidian has no grouping API for the tab bar, this tags tab headers and inserts a chip into the strip (the same kind of tab-bar styling the compact-tabs feature already uses) — it never patches Obsidian's drag or layout engine.

## Scope

- ✅ `Cmd+W` / `Ctrl+W` and any custom hotkey bound to **Close current tab**
- ✅ Running **Close current tab** from the command palette
- ❌ Middle-click or right-click → **Close** on a tab (these bypass the command — by design)
- ❌ **Close others** / **Close tab group**

## Install (manual)

1. Build or download `main.js`, `manifest.json`, and `styles.css`.
2. Copy all three into `<your-vault>/.obsidian/plugins/real-pin/`.
3. In Obsidian, open **Settings → Community plugins**, reload plugins, and enable **Real Pin**.

## Develop

```bash
npm install         # also installs the pre-push git hook (core.hooksPath)
npm run dev         # esbuild watch → main.js
npm run build       # typecheck + production bundle
npm run check       # the full gate: validate + lint + typecheck + test
```

Every change ships production-ready — see [CONTRIBUTING.md](CONTRIBUTING.md) for the bar (strict types, the green `npm run check` gate, pure logic unit-tested under `node --test`, clean teardown, accessibility, and packaging kept in sync).

### End-to-end tests

`npm run test:e2e` drives the compact-pinned-tabs feature in a **real, headless Obsidian** — the automated form of manually pinning tabs in the app. It launches a sandboxed Obsidian via [`obsidian-launcher`](https://www.npmjs.com/package/obsidian-launcher) and drives the renderer over the Chrome DevTools Protocol (Obsidian's packaged-Electron build blocks Playwright, so we use raw CDP, as the Obsidian CLI and WebdriverIO do). It asserts the real behavior: pinning shrinks a tab and hides its title, an unpinned tab is untouched, pin/unpin is reactive, the width slider drives the cap, and the toggle fully reverts.

```bash
npm run build         # the test installs the built plugin, so build first
npm run test:e2e      # needs a display; on a headless box wrap it: xvfb-run -a npm run test:e2e
```

The first run downloads Obsidian (cached afterward under `.obsidian-cache/`). These tests are heavier and slower than the unit gate, so they run in a **separate workflow** ([`e2e.yml`](.github/workflows/e2e.yml), nightly + manual) and are **not** part of the required `check` gate.

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
