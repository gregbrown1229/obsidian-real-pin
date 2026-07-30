# b1 — Middle-click and tab-× close protection

**Effort:** M · **Depends on:** ⚠️ **human sign-off required** (see below),
then spike S9 · **Related:** b2 (command-level protection)

## Problem

The README "Scope" section lists the two biggest real-world holes in the
plugin's core promise as out of scope by design:

- ❌ Middle-click on a pinned tab closes it instantly.
- ❌ The tab-header × button closes it instantly (when Obsidian shows one).

The command wrapper can't see these — they are direct DOM interactions, not
`workspace:close` invocations. The × is arguably the bigger everyday bypass;
both are covered by one mechanism, so do them together.

## ⚠️ Approval gate (CLAUDE.md prime directive 2)

The mechanism defeats Obsidian's own click handling: a **capture-phase
document listener** that calls `preventDefault()` +
`stopImmediatePropagation()` when the gesture targets a pinned tab header.
This relies on undocumented event wiring (which event Obsidian closes on, and
that it binds below document-capture). It is guarded and **fail-open** — if
Obsidian rewires, the tab closes natively, nothing breaks, and the nightly
e2e regression flags the lapse within a day — but per prime directive 2 this
needs explicit human approval before implementation. **Do not start without
that sign-off recorded in the PR.**

## Step 0 — spike S9 (required)

Add a spike to `test/e2e/spikes/` using the existing harness: CDP
`Input.dispatchMouseEvent` supports `button: 'middle'`. Determine empirically
which event closes a tab (`mousedown` button 1, `mouseup`, `auxclick`; and
`click` vs `mousedown` for the × button) by suppressing each in turn and
recording which suppression prevents the close. Design from evidence, not
guesswork. Record findings in `test/e2e/spikes/FINDINGS.md`.

## Implementation sketch

- New `src/closeGuard.ts`, a peer of `compactPinnedTabs.ts`: started from
  `main.ts onload` via `onLayoutReady`, torn down via `plugin.register`;
  covers popouts via the `window-open` event (same pattern as
  `CompactPinnedTabs.start`, `src/compactPinnedTabs.ts:36-43`).
- Per-document delegated listeners:
  `plugin.registerDomEvent(doc, '<event(s) from spike>', handler, { capture: true })`.
- Pinned detection needs **no cast**:
  `target.closest('.workspace-tab-header')?.querySelector('.workspace-tab-header-status-icon.mod-pinned')`
  — the exact DOM key the shipped compact-tabs CSS uses.
- On a middle-click (or ×-click) over a pinned header: suppress, then route
  through the existing policy — `confirmBeforeClose` off → block (+ a2's
  notice); on → `new ConfirmCloseModal(app).ask()` and on confirm resolve the
  leaf (match `tabHeaderEl` identity via the `LeafInternal` guarded cast,
  exported from `controller.ts:32-35` or hoisted to a shared module) and call
  the **public** `leaf.detach()`.
- Scope the suppression narrowly: only the specific button/element cases the
  spike proves close tabs — do not blanket-suppress `mousedown` on headers
  (it would break focus/drag).

## Docs

README "Scope": flip the two ❌ lines to ✅ with a sentence on the residual
risk (protection is fail-open if Obsidian changes its event wiring; nightly
e2e watches it).

## Verification

- New e2e cases in `test/e2e/close-pinned.e2e.mjs`: synthetic middle-click on
  pinned → modal, not closed; on unpinned → closed; ×-click parallel cases;
  toggle-off block behavior; teardown (disable plugin → middle-click closes
  natively again).
- Manual pass with a real mouse in the app (native-feel residual risk — say
  so in the PR).
- `npm run check`; `npm run build`; `xvfb-run -a npm run test:e2e`.
