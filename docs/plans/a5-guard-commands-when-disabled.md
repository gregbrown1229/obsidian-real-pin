# a5 — Stop tab-group commands from silently mutating hidden state

**Effort:** S · **Depends on:** nothing

## Problem

All six tab-group commands are registered unconditionally
(`src/main.ts:61-92`). With **Enable tab groups** off:

- "New tab group from active tab" still calls `createGroup`, which pushes a
  group into `this.groups`; `reconcile()` then early-exits via `clear()`
  (`src/tabGroups/controller.ts:644-648`), so nothing renders — but the
  phantom group *materializes later* when the user enables the feature.
- The other commands silently do nothing.

Either way the user gets zero feedback that the feature is off.

## Change

Convert the six commands to `checkCallback` so they are **hidden from the
command palette** while the feature is disabled — Obsidian's idiomatic
"unavailable command" behavior, and strictly simpler than a Notice:

```ts
this.addCommand({
    id: "new-tab-group",
    name: "New tab group from active tab",
    checkCallback: (checking) => {
        if (!this.settings.enableTabGroups) return false;
        if (!checking) this.tabGroups.createGroupFromActiveLeaf();
        return true;
    },
});
```

Apply the same shape to all six (`new-tab-group`, `save-tab-group`,
`open-saved-groups`, `add-tab-to-group`, `edit-tab-group`,
`toggle-tab-group-collapse`). `open-saved-groups` should stay available
regardless? **No** — decide: the saved-groups panel is meaningless with the
feature off (a7 fixes its dead-end empty state); keep it gated for
consistency. The ribbon icon stays (users can remove ribbon entries natively;
a7's empty state guides anyone who clicks it to the setting).

Belt-and-braces: make `createGroup`/`createGroupFromActiveLeaf` no-op with a
Notice when `enableTabGroups` is false, so programmatic/API callers cannot
create hidden state either.

## Verification

- e2e: with the setting off, execute `real-pin:new-tab-group` by id — assert
  no group exists after enabling the feature (no phantom materialization).
  With the setting on, command works as before.
- Manual: palette does not list the commands while disabled.
- `npm run check`; `npm run build`; `xvfb-run -a npm run test:e2e`.
