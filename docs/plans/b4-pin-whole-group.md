# b4 — Pin/unpin a whole group

**Effort:** S · **Depends on:** nothing

## Problem

The plugin's namesake (pin protection) and its largest feature (tab groups)
don't compose: pinning a five-tab group means five individual pin actions.
A group-level pin makes compact-pinned-tabs and every close protection apply
to the whole group in one gesture.

## Implementation sketch

All public API — `leaf.setPinned(boolean)` and `leaf.getViewState().pinned`
(the typed read accessor `src/main.ts:181` already uses):

1. `src/tabGroups/controller.ts`: new `setGroupPinned(groupId: string,
   pinned: boolean)` — resolve members via the `WorkspaceWithLeafById`
   guarded cast (`getLeafById`), `setPinned(pinned)` on each. Deferred/
   background members resolve fine (that is why `getLeafById` is the chosen
   lookup).
2. In `showChipMenu` (`controller.ts:1011-1040`): compute
   `allPinned = members.every(...)` and add **one** toggle item —
   "Pin all tabs in group" (icon `pin`) when any member is unpinned, else
   "Unpin all tabs in group" (icon `pin-off`). Mixed group → pin-all is the
   least surprising rule.
3. Optional command in `src/main.ts`: "Pin or unpin the active tab's group"
   (gated per a5's `checkCallback` pattern).

No persistence changes: pin state lives in Obsidian's workspace, and
`SavedMember.pinned` is already captured per-member on save.

## Verification

- e2e in `test/e2e/tab-groups.e2e.mjs`: group of three with one pinned →
  menu shows "Pin all tabs in group"; invoke → all pinned (assert via
  `getViewState().pinned`); menu now shows "Unpin all tabs in group";
  invoke → all unpinned. With compact-tabs enabled, pinned members shrink
  (existing CSS reacts for free).
- `npm run check`; `npm run build`; `xvfb-run -a npm run test:e2e`.
