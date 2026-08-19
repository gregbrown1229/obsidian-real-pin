# b8 — Mobile gating for tab-group settings

**Effort:** S · **Depends on:** nothing

## Problem

`manifest.json` has `isDesktopOnly: false`, and that is right for the
namesake — `workspace:close` exists on mobile and `getMostRecentLeaf` is
platform-neutral, so close protection genuinely works there. But tab groups
are unverified on mobile:

- Phones render tabs in a tab switcher, not a strip; if leaves lack
  `tabHeaderEl` there, the code is **inert-but-safe** (verified in code:
  `isManaged` at `src/tabGroups/controller.ts:1059-1064` requires
  `headerEl(leaf)`, so nothing gets tagged and `attachDelegation` never
  runs).
- Tablets render a desktop-like tab bar and *may* expose `tabHeaderEl` —
  partially-working, untested behavior. The e2e harness (desktop Electron)
  cannot answer this.
- `reconcile()` still sets the body class unconditionally on mobile — dead
  but harmless surface.

## Implementation sketch

Gate the settings UI, not the engine:

1. `src/settings.ts`: wrap the call to `addTabGroupsSetting` in
   `if (!Platform.isMobile)` (public API, well under minAppVersion 1.4.0).
   Start conservative with `isMobile`; relax to `Platform.isPhone` only
   after a manual tablet pass proves groups work there.
2. Optional tidy: short-circuit `TabGroupController.start()` on
   `Platform.isMobile` so `setBodyClass` never fires there.
3. The engine must stay inert-safe regardless of the settings UI — a user
   who enabled tab groups on desktop syncs `data.json` to mobile. It already
   is (point 1 above); do not regress that.
4. Do **not** flip `isDesktopOnly` — close protection stays available on
   mobile.

## Verification

- Code-level: `npm run check`; assert desktop behavior unchanged via the
  existing e2e suite.
- Manual (residual risk, state in PR): open the settings tab on a phone —
  no tab-groups section; close protection still prompts. Tablet pass when
  hardware is available decides whether to relax to `isPhone`.
