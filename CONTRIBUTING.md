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
- **Internal/untyped Obsidian APIs** (e.g. `app.commands`, `leaf.tabHeaderEl`,
  `app.plugins`) are reached through a **narrow `as unknown as { … }` cast that
  models only the sliver you touch** — never a blanket `any`. See `main.ts`
  (`commands`) and `compactPinnedTabs.ts` (`tabHeaderEl`, `plugins`).
- **Pure logic is extracted and unit-tested.** Decision logic goes in an
  `obsidian`-free module (e.g. `src/compactPolicy.ts`) with erasable-syntax-only
  exports, and gets a `node --test` truth-table test in `scripts/*.test.mjs`.
  The tested code is the shipped code — the controller imports the same module.
  (Tests import the `.ts` source directly via Node's native type-stripping;
  requires Node ≥ 22.18, which CI and the dev toolchain use.)
- **Behavior that only exists inside Obsidian gets an end-to-end test.** Anything
  the unit gate can't reach — real tab DOM, cross-plugin integration (Iconize),
  pin/unpin, that `styles.css` actually applies — goes in `test/e2e/*.e2e.mjs`,
  which drives a real headless Obsidian over CDP (see the README). E2E is the
  automated form of manual checklists; prefer it over "I clicked around and it
  worked." Keep it in its own workflow, off the fast `check` gate.
- **Clean lifecycle / teardown.** Wire listeners and patches through
  `registerEvent` / `register` so they auto-unwind on unload. Anything that
  mutates the DOM must fully reverse on teardown, setting-off, and dependency
  loss. Never leave orphaned classes, attributes, or listeners.
- **Don't touch other plugins' nodes.** Integrate by reading their public-ish
  state and degrade gracefully (`typeof` guards, inert fallback) when an optional
  dependency is missing or changes shape. Features are off by default and opt-in.
- **Accessibility is not optional.** If you hide text, re-expose it (e.g.
  `aria-label`). Keep hit targets (close button, context menu) reachable.
- **Styles live in `styles.css`**, scoped under a feature-specific marker class —
  never injected via `innerHTML` or inline `<style>`, and zero visual effect
  until the feature applies the marker.

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
