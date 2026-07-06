# a2 — Notice feedback when block mode refuses a close

**Effort:** S · **Depends on:** nothing

## Problem

With **Confirm before closing a pinned tab** toggled off, the wrapped
`workspace:close` callback blocks the close by returning `true` with no
feedback (`src/main.ts:187-190`). The user presses `Cmd+W` on a pinned tab and
nothing visibly happens — it reads as "plugin broken" rather than "pin doing
its job".

## Change

In the block branch of `patchedCheckCallback` (`src/main.ts`):

1. Show `new Notice("Pinned tab — close blocked. Unpin it to close.")`
   (sentence case; the `obsidianmd` lint rule enforces it).
2. Rate-limit against key-repeat spam **without timers**: keep the last Notice
   in a `let blockNotice: Notice | null` local in `patchCloseCommand`'s scope
   (the wrapper closure already captures locals — `main.ts:155`), and skip
   showing a new one while `blockNotice?.noticeEl.isConnected` is true.
   `Notice.noticeEl` is public API. No `setTimeout`, no timestamps.

## Docs

- README settings paragraph ("blocked entirely: no dialog, the tab never
  closes") gains a mention of the notice.
- Setting description in `src/settings.ts:62-63` ("blocked entirely") — append
  "(a notice explains why)".

## Verification

- Extend the existing block-mode e2e
  (`test/e2e/close-pinned.e2e.mjs:218`): assert the notice element appears,
  the modal does not, and the tab stays open.
- Fire the command twice rapidly; assert only one notice element exists.
- `npm run check`; `npm run build`; `xvfb-run -a npm run test:e2e`.
