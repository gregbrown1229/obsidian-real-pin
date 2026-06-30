# Plan 0 — Spike findings & go/no-go

Run in real headless Obsidian via `test/e2e/spikes/spikes.mjs` + `probe-order.mjs`
(`npm run build && xvfb-run -a node test/e2e/spikes/spikes.mjs`). These are
throwaway de-risking probes, not part of the `check`/`test:e2e` gate.

| Spike | Result | Verdict |
|---|---|---|
| **S1** data-* attr persistence | attrs survive open/activate/close; `tabHeaderEl` identity stable | ✅ GO — tag headers with `data-*`, style via CSS |
| **S2** chip survival | injected chip survived re-renders; idempotent re-insert → no dupes | ✅ GO — insert chip, re-ensure each reconcile |
| **S3** leaf identity + order | `leaf.id` stable string, present in `getLayout()`; strip order resolves exactly via header→leaf identity | ✅ GO — key membership by `leaf.id`, read order from headers |
| **S4** reconcile triggers | `layout-change` + `active-leaf-change` fire on open/close (≈2× per change) | ✅ GO — drive a debounced reconcile; add a MutationObserver for native drag |
| **S5** native tab menu hook | synthetic right-click did NOT fire `file-menu` / no `tab-header` source | ❌ NO — own chip menu + commands + sidebar instead |
| **S6** save/reopen | `getViewState`→`setViewState` round-trips (type+file+mode); missing file → empty view, no throw; `isDeferred` absent in this build | ✅ GO — round-trip; tolerate missing files; guard deferred APIs |
| **S7** reorder/move existing tab | `createLeafInParent(parent,i)` works; `parent.removeChild(leaf)`+`parent.insertChild(i,leaf)` moves an existing tab and keeps it open | ✅ GO (internal API) — contiguity-snap + chip-drag-move feasible, guarded |
| **S8** multi-window | popout reachable via `iterateAllLeaves`; container reachable; attrs settable | ✅ GO — manage per-window |

## Adjustments to the plan
- **Menu (Plan 3):** rely on our own chip context menu + command palette + sidebar; do not depend on the native tab right-click menu (S5).
- **Move APIs (Plan 4):** `removeChild`/`insertChild` on the `WorkspaceTabs` parent are internal/undocumented — reach via a narrow cast, guard with `typeof`, and degrade to "membership-follows-native-drag" if absent.
- **Empty tab group edge:** closing the last tab in a group removes the group container; `getLeaf('tab')` throws "No tab group found" when no tab group exists. Reopen-into-current must create a leaf safely (use `getLeaf('tab')` which recreates when at least one group exists, else `getLeaf(false)`/split).
- **Deferred views:** not present in the tested build, but guard `isDeferred`/`loadIfDeferred` for newer Obsidian.
