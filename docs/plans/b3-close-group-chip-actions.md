# b3 — "Close group" / "Save and close group" chip actions

**Effort:** S/M · **Depends on:** a4 (generalized confirm modal)

## Problem

The chip menu (`src/tabGroups/controller.ts:1011-1040`) offers
Collapse/Expand, Edit, Save group, Ungroup — but no way to *close* a group.
Chrome's hide-group workflow (save it, close its tabs, restore later from the
library) is the natural way to declutter the tab bar, and the saved-groups
panel already provides the restore half.

## Implementation sketch

All in `src/tabGroups/controller.ts` unless noted:

1. New `closeGroup(groupId: string, saveFirst: boolean)`:
   - Resolve member leaves via the `WorkspaceWithLeafById` guarded cast
     (`getLeafById`, same as `pruneClosedGroups` at `:577-579`).
   - If `saveFirst`: call the existing `saveGroup(groupId)` **before any
     detach** — it snapshots via `snapshotMembers`, so ordering is
     load-bearing.
   - Partition pinned (`leaf.getViewState().pinned`) vs unpinned.
   - No pinned members: detach all (public `leaf.detach()`) **synchronously
     in one loop**, then `reconcile()` once — `pruneClosedGroups` removes the
     group before `syncLinkedSaved` (`:626`) can snapshot a half-closed
     member list. Do not rely on the 30 ms `schedule` debounce for this.
   - Pinned members present: `settings.confirmBeforeClose` on → one summary
     confirm via the a4-generalized modal ("Close group \"<name>\"? It
     contains N pinned tabs." / confirm "Close all"); off → detach only
     unpinned + `Notice("Kept N pinned tabs")`.
2. Two `menu.addItem` entries in `showChipMenu`, after "Save group":
   "Save and close group" (icon `save`) and "Close group" (icon `x`).
3. Optional: commands in `src/main.ts` for the active tab's group (gated per
   a5's `checkCallback` pattern).

`linkedLiveGroupId` pointing at the now-closed group is harmless — a1's
focus-if-open check tolerates it and `openSavedGroup` relinks on reopen.

## Verification

- e2e in `test/e2e/tab-groups.e2e.mjs`:
  - "Save and close" → saved snapshot contains the **full** member list
    (regression against the half-closed-snapshot race), tabs closed, group
    gone, panel row present; Open restores.
  - "Close group" with a pinned member and confirm off → pinned survives,
    notice shown.
- `npm run check`; `npm run build`; `xvfb-run -a npm run test:e2e`.
