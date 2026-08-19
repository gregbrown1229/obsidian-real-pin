# b5 — Keyboard group navigation and move commands

**Effort:** M · **Depends on:** nothing

## Problem

Tab groups are mouse-only beyond the existing commands: there is no way to
jump between groups or re-home a tab from the keyboard. Four commands close
the gap:

- "Focus next tab group" / "Focus previous tab group"
- "Move active tab to next group" / "Move active tab to previous group"

## Implementation sketch

This is the one plan that adds real decision logic — it goes in the pure
model, per CONTRIBUTING.md.

1. **`src/tabGroups/model.ts`** — pure helper, e.g.:

   ```ts
   adjacentGroupTarget(
       order: readonly string[],            // strip order, leaf ids
       groupOf: ReadonlyMap<string, string>, // leaf id → group id
       activeId: string,
       dir: 1 | -1,
   ): { groupId: string; firstMemberId: string } | null
   ```

   Collapse the strip into units (group runs + singleton ungrouped tabs —
   the same concept the drop logic already uses), find the active unit, walk
   in `dir` to the next unit **that is a group**, wrapping at the ends;
   return null when no other group exists. Reuse `groupOfMap` (already
   exported from `model.ts`).
2. **Truth table** in `scripts/tabGroups.test.mjs`: ungrouped active tab,
   active in the only group (null), wrap-around both directions, collapsed
   target, two adjacent groups, active tab mid-group.
3. **`src/tabGroups/controller.ts`**:
   - `focusAdjacentGroup(dir)` — `activeManagedLeaf()`,
     `orderInParent(leaf)` (exists, `:530`), call the helper, resolve via
     `getLeafById`, `setActiveLeaf(leaf, { focus: true })` (public).
     Collapsed targets auto-expand for free via the existing
     `active-leaf-change` → `expandGroupOf` path (`:197`).
   - `moveActiveLeafToAdjacentGroup(dir)` — same walk for the target group
     id, then the existing `addLeafToGroup(leafId, targetGroupId)` (which
     already snaps contiguity). No adjacent group → Notice + no-op.
4. **`src/main.ts`**: four `addCommand`s, gated per a5's `checkCallback`
   pattern. Scope v1 to the active strip only; say so in the command names'
   descriptions if ambiguous.

Known tolerance: `orderInParent` internally uses `iterateAllLeaves` to build
the header→leaf map — missing background leaves just drop out of `order`,
the same exposure the existing drag reconcile already accepts. No new casts.

## Verification

- Unit: the truth table above (`npm test`).
- e2e in `test/e2e/tab-groups.e2e.mjs`: two groups + ungrouped tabs; focus
  next/previous by command id → active leaf lands on group heads (wrapping);
  move active tab to next group → membership + contiguity assertions.
- `npm run check`; `npm run build`; `xvfb-run -a npm run test:e2e`.
