# Contributing

Real Pin is a published community plugin. **Every feature ships production-ready
— not "works on my machine".** This document is the bar. It applies to all future
features, not just the ones already here.

## The gate is non-negotiable

`npm run check` must be green before anything is committed or pushed:

```bash
npm run check   # validate + lint + typecheck + test
npm run build   # typecheck + production bundle (emits main.js)
```

It runs in three places, so a non-compliant change can't slip through: the
**pre-push git hook** (`.githooks/pre-push`), **CI** on every PR/push
(`.github/workflows/ci.yml`), and the **release workflow**
(`.github/workflows/release.yml`). Don't bypass them; fix the code.

`npm run lint` runs the official
[`eslint-plugin-obsidianmd`](https://github.com/obsidianmd/eslint-plugin)
recommended set, including **`no-unsupported-api`**, which reads
`manifest.json`'s `minAppVersion` and rejects any Obsidian API newer than it.
Before using an API, confirm it's available at `minAppVersion` (currently
`1.4.0`) — or guard/polyfill it, as `ConfirmCloseModal` does for `setWarning()`
vs the newer `setDestructive()`.

## Code standards

- **Strict TypeScript, no `any`.** `tsconfig` is `strict`. Type the real thing.
- **Prefer the platform; write the least code that works.** If CSS or a built-in
  Obsidian affordance can do the job, don't reach for JavaScript. Compact-pinned-
  tabs is **pure CSS**, keyed on Obsidian's own pin element
  (`:has(.workspace-tab-header-status-icon.mod-pinned)`); an earlier event-driven
  controller that reconciled a marker class on every tab was deleted in favor of
  it, removing an entire class of pin/unpin and paint-timing races. Less surface,
  fewer bugs.
- **Internal/untyped Obsidian APIs** (e.g. `app.commands`) are reached through a
  **narrow `as unknown as { … }` cast that models only the sliver you touch** —
  never a blanket `any`. See `main.ts` (`commands`). Prefer public API first: the
  compact-tabs controller reaches popout `<body>` elements via the public
  `leaf.view.containerEl.ownerDocument`, no cast at all.
- **When there's real decision logic, extract and unit-test it.** Put it in an
  `obsidian`-free, erasable-syntax-only module and give it a `node --test`
  truth-table in `scripts/*.test.mjs`, importing the `.ts` source directly via
  Node's native type-stripping (Node ≥ 22.18). Keep the tested code the shipped
  code. (No module needs this today — the close-command logic is a few live
  branches and compact-tabs is pure CSS — but reach for it the moment a feature
  grows a non-trivial predicate.)
- **Behavior that only exists inside Obsidian gets an end-to-end test.** Anything
  the unit gate can't reach — real tab DOM, pin/unpin, that `styles.css` actually
  applies and reverts — goes in `test/e2e/*.e2e.mjs`, which drives a real headless
  Obsidian over CDP (see the README). E2E is the automated form of manual
  checklists; prefer it over "I clicked around and it worked." Keep it in its own
  workflow, off the fast `check` gate.
- **Clean lifecycle / teardown.** Wire listeners and patches through
  `registerEvent` / `register` so they auto-unwind on unload. Anything that
  mutates the DOM must fully reverse on teardown, setting-off, and dependency
  loss. Never leave orphaned classes, attributes, or listeners.
- **Don't touch other plugins' nodes.** Integrate by reading their public-ish
  state and degrade gracefully (`typeof` guards, inert fallback) when an optional
  dependency is missing or changes shape. Features are off by default and opt-in.
- **Accessibility is not optional.** If you hide text, make sure it's still
  exposed — re-expose it yourself (e.g. `aria-label`), or confirm the platform
  already does (compact-tabs hides the visible title, but Obsidian's own header
  `aria-label` + hover tooltip keep the name available). Keep hit targets (close
  button, context menu) reachable.
- **Styles live in `styles.css`**, scoped under a feature gate — a body class the
  plugin toggles and/or Obsidian's own state via `:has()` — never injected via
  `innerHTML` or inline `<style>`, and zero visual effect until the feature is
  enabled.

## Packaging stays in sync

A feature isn't done until it's shippable end-to-end. If you add a runtime
artifact (like `styles.css`), update **every** place that distributes it:

- the manual-install steps in `README.md`,
- the release asset list in `.github/workflows/release.yml`.

Don't bump the version by hand in a feature PR — releases are cut separately and
own version consistency (see below).

## Cutting a release

```bash
npm version patch        # bumps manifest/package/versions, validates, commits, tags (no 'v')
git push --follow-tags   # pre-push hook gates it → release workflow builds an attested draft
```

Then publish the draft. Always release via tag push — creating a release by hand
in the GitHub UI bypasses the validation pipeline.
