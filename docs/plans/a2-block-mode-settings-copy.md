# a2 — Make the silent block mode discoverable in settings

**Effort:** S · **Depends on:** nothing

## Problem — and what is *not* the problem

With **Confirm before closing a pinned tab** toggled off, the wrapped
`workspace:close` callback blocks the close by returning `true`
(`src/main.ts:187-190`). The user presses `Cmd+W` on a pinned tab and nothing
happens.

**This silent block is intentional and stays.** A runtime `Notice` on every
blocked `Cmd+W` was considered and **rejected** — it would fire on every stray
close keystroke, exactly the high-frequency gesture the feature exists to
absorb, turning a quiet guard into a nag. The behavior is correct; only its
*discoverability* is the gap. A user who forgets they enabled block mode can
read `Cmd+W`-does-nothing as a broken plugin.

## Change — documentation only, no runtime behavior change

1. **Setting description** (`src/settings.ts:61-64`): make the "off" branch
   spell out the silent-block outcome. Current:

   > "On: closing a pinned tab via a hotkey or command asks for confirmation.
   >  Off: closing a pinned tab that way is blocked entirely."

   Revised (sentence case; `obsidianmd` lint enforces it):

   > "On: closing a pinned tab via a hotkey or command asks for confirmation.
   >  Off: that close is blocked silently — the hotkey does nothing and no
   >  dialog appears. Unpin the tab to close it by keyboard."

2. **README** settings paragraph (`README.md:11-16`): the existing "Off"
   bullet already says "blocked entirely… Unpin it first to close it by
   keyboard" — tighten it to name the silence explicitly ("the hotkey does
   nothing, with no dialog") so README and settings read the same.

No code path changes; `src/main.ts` is untouched.

## Verification

- `npm run check` (the `obsidianmd` lint set validates the sentence-case
  description). No behavior change, so no new e2e — the existing block-mode
  test (`test/e2e/close-pinned.e2e.mjs:218`) continues to assert the silent
  block.
- Manual: read the setting; confirm the copy explains the silence.
