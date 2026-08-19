# a1 — Focus instead of duplicating an already-open saved group

**Effort:** S · **Depends on:** nothing · **Blocks:** b6

## Problem

`openSavedGroup` (`src/tabGroups/controller.ts:422-446`) always opens every
saved member as a new tab. It never checks whether the saved group's
`linkedLiveGroupId` still points at an open live group, so pressing **Open**
in the saved-groups panel twice opens a full duplicate set of tabs. Chrome's
saved groups focus the existing group instead.

## Change

All in `src/tabGroups/controller.ts`, at the top of `openSavedGroup`:

1. If `saved.linkedLiveGroupId` is set, look up
   `live = this.groups.find((g) => g.id === saved.linkedLiveGroupId)`.
2. If found, resolve the first **open** member using the existing
   `WorkspaceWithLeafById` guarded cast — the same `getLeafById` pattern
   `pruneClosedGroups` uses (`controller.ts:577-579`). Do **not** use the
   private `leafById` helper if it is `iterateAllLeaves`-based (unreliable per
   CLAUDE.md); as a drive-by, consider migrating `leafById` itself to
   `getLeafById`.
3. If an open member exists:
   `this.plugin.app.workspace.setActiveLeaf(leaf, { focus: true })` (public
   API, well under minAppVersion 1.4.0), set `live.collapsed = false`, call
   `this.reconcile()`, and return. No Notice needed — the focus is
   self-evident.
4. If `getLeafById` is absent (never in practice), fall through to the current
   reopen behavior.

`pruneClosedGroups` already drops live groups with zero open members, so
"live group exists" nearly implies "has an open member"; the `getLeafById`
check makes it exact.

## Out of scope (deliberate)

Replenishing a *partially* open group (user closed some members) — focusing is
the correct v1; "reopen missing members into the live group" is a clean v2.

## Verification

- e2e in `test/e2e/tab-groups.e2e.mjs`: save a group, press Open twice, assert
  the tab count did not grow and the group's first member is active.
- Existing behavior preserved: with the linked live group fully closed, Open
  reopens all members (existing test path).
- `npm run check` green; `npm run build`; `xvfb-run -a npm run test:e2e`.
