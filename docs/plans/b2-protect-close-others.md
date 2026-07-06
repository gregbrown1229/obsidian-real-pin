# b2 — Pinned-aware "Close others" / "Close this tab group"

**Effort:** M · **Depends on:** b7 recommended first (shares the
enumerate-and-detach helper) · **Related:** b1

## Problem

`workspace:close-others` and `workspace:close-tab-group` (IDs to be verified)
close pinned tabs along with everything else — the README's remaining ❌
Scope line. The native implementations are all-or-nothing; they cannot be
made to spare pinned tabs.

## Step 0 — verify command IDs

Small spike (or extend spike S9): dump
`Object.keys(app.commands.commands).filter(id => id.startsWith('workspace:'))`
and each candidate's callback shape (`checkCallback` vs `callback`) in the
e2e harness. The existing wrapper degrades to a no-op when the shape doesn't
match (`src/main.ts:149`), so a future rename fails safe.

## Implementation sketch

1. Refactor `patchCloseCommand` (`src/main.ts:142-203`) into a generic
   `patchCommand(id: string, policy: (next, checking) => unknown)`; register
   the existing close wrapper plus the two new ones through it, all via
   `this.register(around(...))`.
2. Policy for both commands, when the target strip contains pinned tabs:
   **replace** the native action with the plugin's own loop —
   - Enumerate siblings via the active leaf's `parent.children` through the
     existing `TabsInternal` guarded cast (`src/tabGroups/controller.ts:38-42`
     — hoist to a shared `src/internals.ts` or export). **Never**
     `iterateAllLeaves` (CLAUDE.md: unreliable enumerator). If `children` is
     absent, fall through to the native callback (protection lapses
     gracefully rather than half-closing).
   - `close-others`: detach every unpinned non-active sibling via public
     `leaf.detach()`; if pinned were spared, one `Notice("Kept N pinned
     tabs")`.
   - `close-tab-group`: same including the active leaf; if every tab is
     pinned, Notice and do nothing.
   - No pinned targets → `next.call(this, false)` (native behavior,
     untouched semantics).
3. Skip-and-summarize, **not** confirm-per-tab — a modal chain would be
   miserable. (Product alternative — one summary confirm when
   `confirmBeforeClose` is on — was considered; the skip+Notice version is
   smaller and consistent. Revisit only if users ask.)
4. The `checkCallback(true)` availability probe must delegate untouched,
   exactly as `main.ts:164` does.

If b7 landed first, reuse its "enumerate strip, partition pinned, detach
unpinned" helper instead of re-implementing.

## Risks

When we take over, we perform a plainer close than native (ordering/history
nuances may differ) — note it in the PR. Command IDs are undocumented; the
degrade-to-noop guard covers renames.

## Docs

README "Scope": flip the "Close others / Close tab group" ❌ to ✅ with the
spared-pinned semantics spelled out.

## Verification

- e2e in `test/e2e/close-pinned.e2e.mjs`: strip with pinned+unpinned tabs,
  execute each command by id → pinned survive, unpinned close, notice shown;
  strip with no pinned → native behavior.
- `npm run check`; `npm run build`; `xvfb-run -a npm run test:e2e`.
