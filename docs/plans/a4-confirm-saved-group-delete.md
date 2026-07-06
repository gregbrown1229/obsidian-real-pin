# a4 — Confirm before deleting a saved group

**Effort:** S · **Depends on:** a3 (soft — same file; preserve its focus
behavior) · **Blocks:** b3

## Problem

`deleteSavedGroup` (`src/tabGroups/controller.ts:448-454`) destroys a library
entry irreversibly, triggered from a menu item that sits one slot below "Edit"
(`src/tabGroups/SavedGroupsView.ts:107-112`). One mis-click and a saved group
is gone.

## Change

1. **Generalize `ConfirmCloseModal`** (`src/ConfirmCloseModal.ts`) — it is
   already promise-based and reusable. Add constructor parameters for title,
   body, and confirm-button label, defaulting to the current pinned-tab text
   so the existing call site (`src/main.ts:196`) is unchanged. Keep the
   destructive styling (`markDestructive`) and a3's focused-confirm behavior.
   Consider renaming to `ConfirmModal` with `ConfirmCloseModal` retained as
   the default-text construction, or just parameterize in place — smallest
   diff wins.
2. **Gate the delete** in `deleteSavedGroup` (or at the menu call site in
   `SavedGroupsView.showMenu`):
   `Delete saved group "<name>"?` / body mentioning the member count /
   confirm label "Delete". Only filter + persist on confirm.

The alternative (delete immediately + "Undo" in a Notice) was considered and
rejected: it needs new restore plumbing; a confirm reuses a modal we already
have.

## Verification

- Unit: none needed (no new pure logic).
- e2e in `test/e2e/tab-groups.e2e.mjs`: trigger delete, press Esc → entry
  still listed; trigger again, confirm → entry gone and `data.json` updated.
- `npm run check`; `npm run build`; `xvfb-run -a npm run test:e2e`.
