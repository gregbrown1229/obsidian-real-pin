# a7 — Saved-groups panel: dead-end empty state, friendly member labels

**Effort:** S · **Depends on:** nothing

## Problem

`src/tabGroups/SavedGroupsView.ts`:

1. The empty state (`:39-45`) says "Create a tab group, then save it from the
   chip menu" even when **Enable tab groups** is off — there are no chips, so
   the instruction is a dead end. The ribbon icon is always visible, so users
   land here with the feature disabled.
2. `memberLabel` (`:118-125`) falls back to the raw `viewState.type` for
   non-file views — a saved graph tab renders as `graph`, a developer token
   rather than a label.

## Change

In `SavedGroupsView.render` / `memberLabel`:

1. Branch the empty state on `this.plugin.settings.enableTabGroups`:
   - Disabled: "Tab groups are disabled. Turn on **Enable tab groups** in
     Settings → Real Pin to use saved groups." (Plain text is fine; a button
     that deep-links to the plugin's settings tab would need the internal
     `app.setting` surface — **not** worth a new cast. Text only.)
   - Enabled: keep the current copy.
2. Friendly labels for non-file members: map common core view types to
   display names (`graph` → "Graph view", `canvas` → basename of the canvas
   file if present in state, `empty` → "New tab", `search` → "Search",
   `bookmarks` → "Bookmarks"), falling back to a capitalized type. Keep the
   map small and local to `memberLabel`; this is presentation, not model
   logic.

## Verification

- e2e/manual: open the panel with the feature off → guidance text; enable →
  original empty text; save a group containing a graph view → list shows
  "Graph view".
- `npm run check`; `npm run build`.
