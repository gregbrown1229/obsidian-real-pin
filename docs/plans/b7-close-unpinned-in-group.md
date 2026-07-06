# b7 — "Close all unpinned tabs in this tab group" command

**Effort:** S · **Depends on:** nothing · **Blocks (soft):** b2 reuses the
helper this introduces

## Problem

Users who keep pinned tabs fear "Close all other tabs" — it kills pinned tabs
too (until b2 lands, and b2 carries semantic risk). A plugin-owned,
zero-hack alternative gives the safe bulk-close immediately: close every
**unpinned** tab in the active tab strip, sparing pinned ones.

Note "tab group" here means Obsidian's native tab container (a strip), not a
Real Pin colored group — name the command to match Obsidian's own "Close
this tab group" wording so it reads consistently in the palette.

## Implementation sketch

1. Helper (new small module or on the plugin class; b2 will reuse it):
   enumerate the active strip via the active leaf's `parent.children`
   through the existing `TabsInternal` guarded cast
   (`src/tabGroups/controller.ts:38-42` — hoist/export it). **Never**
   `iterateAllLeaves` (CLAUDE.md). If `children` is absent, Notice
   ("Couldn't enumerate this tab group") and do nothing.
2. Partition by `leaf.getViewState().pinned`; detach unpinned via public
   `leaf.detach()` in one synchronous loop.
3. Feedback: `Notice("Closed N tabs, kept M pinned")` (sentence case).
4. Register in `src/main.ts` as e.g. `close-unpinned-in-tab-group`,
   "Close all unpinned tabs in this tab group". This is independent of the
   tab-groups feature flag — it concerns *pinned* tabs, the namesake — so
   register it unconditionally with a plain `callback` (no a5 gating).

No new casts, no monkey-patching, no undocumented command IDs. ~30 lines.

## Verification

- e2e in `test/e2e/close-pinned.e2e.mjs`: strip with 2 pinned + 3 unpinned →
  run command → pinned survive, unpinned closed, notice text correct; strip
  with all pinned → nothing closes.
- `npm run check`; `npm run build`; `xvfb-run -a npm run test:e2e`.
