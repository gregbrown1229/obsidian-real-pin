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

## Step 0 — spike S9: **done**, premise confirmed

Probed against a real headless Obsidian:

- **The gap is real.** A middle-click on a **pinned** tab closes it. (Unpinned
  closes too, confirming the gesture was actually exercised.)
- **The × is real.** A pinned tab's header does contain a
  `.workspace-tab-header-inner-close-button` — one per header.
- **The harness can drive it.** Obsidian implements middle-click closing in its
  own JS listeners, so a *synthetic* `MouseEvent` sequence (`mousedown` /
  `mouseup` / `auxclick`, `button: 1`) triggers the close — no CDP
  `Input.dispatchMouseEvent` needed. This is unlike native OS drag, which can't
  be scripted. **So b1 is fully e2e-testable.**

Still unknown, and worth one more probe before writing the guard: **which** of
those three events Obsidian actually closes on. Determine it by suppressing each
in turn (capture-phase `preventDefault` + `stopImmediatePropagation`) and
recording which suppression prevents the close — then guard only that event, so
the suppression stays as narrow as possible.

Note the related finding that retired b2/b7: Obsidian **does** already spare
pinned tabs in `close-others` / `close-tab-group`. That it does *not* spare them
on middle-click looks like an inconsistency on Obsidian's side rather than a
deliberate stance — worth mentioning if this is ever raised upstream, which
would be the cleanest fix of all.

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
