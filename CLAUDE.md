# CLAUDE.md

Operating guide for AI agents (and humans) working in this repo. Read it before
you change anything.

**Real Pin** is a published Obsidian community plugin. The bar is: every change
ships production-ready, elegant, and maintainable — never "works on my machine,"
never a hack someone else has to decode later.

## Prime directives

1. **Elegance, simplicity, maintainability over cleverness.** Prefer the smallest
   change that solves the *whole* problem. Prefer the platform — CSS or a built-in
   Obsidian affordance — over JavaScript; prefer deleting code over adding it. Match
   the surrounding code's idiom, naming, and comment density. If a change is growing
   convoluted, stop and find the simpler shape.
2. **No hacks or workarounds without explicit human approval.** If the only way
   forward is a hack — monkey-patching Obsidian internals beyond the existing narrow
   guarded casts, relying on undocumented behavior without a guard, `setTimeout`/
   timing guesses, an `any` cast, disabling a lint rule, or bypassing the check
   gate — **stop and ask a human first.** State what the hack is, why it's needed,
   the risk, and the clean alternative you rejected. Implement only after sign-off,
   kept isolated and commented with the reason. When something genuinely can't be
   done cleanly, **say so plainly** instead of cobbling it together.
3. **The green gate is non-negotiable.** `npm run check` must pass before any commit
   or push. Don't bypass the pre-push hook, CI, or the release workflow — fix the
   code. (Details in `CONTRIBUTING.md`.)

## Standards live in CONTRIBUTING.md

`CONTRIBUTING.md` is the source of truth for code standards: strict TypeScript /
no `any`, narrow guarded casts for internal APIs, pure + unit-tested decision
logic, e2e for Obsidian-only behavior, clean teardown, accessibility, styles in
`styles.css` under a feature gate, packaging sync, and cutting a release. Follow
it; don't restate or contradict it here.

## Commands

```bash
npm run check                 # validate + lint + typecheck + unit tests — the gate
npm run build                 # typecheck + production bundle → main.js
npm test                      # unit tests only (node --test, scripts/*.test.mjs)
xvfb-run -a npm run test:e2e  # headless-Obsidian e2e (test/e2e/*.e2e.mjs); needs a display
```

Verify behavior, don't assume it: build, run the gate, and drive the affected flow
(e2e) before committing anything non-trivial.

## Architecture orientation

- `src/main.ts` — plugin entry: lifecycle, versioned settings load/save
  (`migrateData`), command/view/ribbon registration. Everything goes through
  `register*` so it auto-unwinds on unload.
- `src/tabGroups/model.ts` — **pure, `obsidian`-free decision core** (membership
  reconcile, naming, data migration). Erasable-syntax only; unit-tested in
  `scripts/tabGroups.test.mjs`. Non-trivial logic lives here, not in the glue.
- `src/tabGroups/controller.ts` — thin Obsidian glue: an **idempotent reconcile**
  that reads the tab strip and reflects the model as `data-*` attributes plus a chip
  element; CSS does the rest. Observers are disconnected while we write so we never
  feed our own mutations back in.
- `src/tabGroups/{overlay,modals,SavedGroupsView}.ts`, `src/{settings,
  ConfirmCloseModal,compactPinnedTabs}.ts` — DOM helpers, modals, the sidebar view,
  settings, and the pure-CSS compact-tabs feature.
- `styles.css` — all styling, gated under a body class / Obsidian `:has()` state;
  inert until the feature is enabled.

## Obsidian lessons learned the hard way — don't relearn these

Real constraints discovered in this codebase. Respect them or you'll ship
regressions:

- **`iterateAllLeaves` is not a reliable enumerator.** It intermittently omits
  deferred/background tabs. Never use it for existence checks or completeness-
  sensitive logic. To ask "is this leaf still open?" use `getLeafById(id)` (guarded
  cast). To enumerate a strip, read the DOM (`data-rp-group`, `parent.children`) —
  not a leaf scan.
- **Never mutate the DOM inside a `dragstart` handler.** Chromium/Electron aborts
  the native drag (Chromium bug 168544). Defer any DOM change to a
  `requestAnimationFrame` after `dragstart` returns; mutating mid-drag (`dragover`)
  is fine.
- **`data-*` attributes survive Obsidian's clone-based tab-strip re-renders;
  per-element listeners do not.** Drive injected elements (chips) with **delegated,
  document-level listeners** keyed off `data-*`, so the original and any clone both
  work.
- **Native OS drag-and-drop can't be scripted in the headless CDP harness.** Cover
  everything up to that boundary with e2e (synthetic events, DOM order); the actual
  native-drag *feel* must be verified by hand in the app — and say so when that's
  the residual risk.
- **Reach internal/undocumented Obsidian surface only through a narrow, guarded
  `as unknown as { … }` cast** that models just the sliver you touch (`leaf.id`,
  `leaf.tabHeaderEl`, `WorkspaceTabs` child ops, `getLeafById`), degrading to inert
  if it's absent. Confirm any public API exists at `minAppVersion` — `lint`'s
  `no-unsupported-api` enforces this.
- **UI text is sentence case** (the `obsidianmd` lint rule enforces it): "Add tab to
  new group", not "Add Tab To New Group".

## Working agreement

- Develop on a feature branch kept current with `main`. Open a **draft PR**; get the
  check gate green in CI before marking it ready.
- **Releases are human-triggered via tag push** (`CONTRIBUTING.md`). Some
  environments can't push to `main` or push tags — in that case, hand the exact
  commands to a human rather than working around the restriction.
- When in doubt about scope, feasibility, or a trade-off the user owns, **ask** —
  don't guess, and don't cobble.
