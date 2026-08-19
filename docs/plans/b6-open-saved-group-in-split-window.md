# b6 — Open a saved group in a split or new window

**Effort:** M · **Depends on:** a1 (focus-if-open is the uniform precedence
rule)

## Problem

`openSavedGroup` only opens into the current tab area. Restoring a reference
group next to current work (split) or on another monitor (popout window) are
natural asks the panel can't serve.

## Implementation sketch

1. **`src/tabGroups/controller.ts`**: extend the signature —
   `openSavedGroup(savedId: string, target: 'tab' | 'split' | 'window' = 'tab')`.
   - a1's focus-if-open check runs **first regardless of target** — with the
     linked-group model, focusing the one live instance is the only coherent
     answer (no second copies). Document this in the method comment.
   - First member: `ws.getLeaf(target)` (public since 0.16.x, safely under
     minAppVersion 1.4.0 — `no-unsupported-api` confirms). Keep the existing
     try/catch fallback for the empty-workspace edge.
   - Then `ws.setActiveLeaf(firstLeaf, { focus: true })` so the remaining
     members' `getLeaf("tab")` calls land in the **new** container; loop
     unchanged.
   - If e2e shows the retargeting race, switch to
     `createLeafInParent(firstLeaf.parent, i)` (spike S7 validated it) —
     **no `setTimeout` waits**; timing guesses are a prime-directive-2
     violation.
2. **`src/tabGroups/SavedGroupsView.ts`** (`showMenu`, `:87-114`): two items
   under "Open" — "Open in split", "Open in new window"; the latter omitted
   when `Platform.isMobile` (public API).

## Risks

The `'window'` path has real timing exposure (popout document/leaf creation
vs the subsequent `getLeaf` calls). Split is fully e2e-coverable; popout
needs a manual pass — state it as the residual risk in the PR, per CLAUDE.md
convention.

## Verification

- e2e in `test/e2e/tab-groups.e2e.mjs`: "Open in split" → members land in a
  new `WorkspaceTabs` container (assert distinct `parent`), regrouped with
  name/color; default Open unchanged; focus-if-open precedence holds for all
  targets.
- Manual: "Open in new window" on desktop — members land in the popout,
  grouped; window close behaves.
- `npm run check`; `npm run build`; `xvfb-run -a npm run test:e2e`.
