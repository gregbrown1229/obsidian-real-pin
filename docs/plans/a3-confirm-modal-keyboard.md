# a3 — Keyboard-fluent confirm modal

**Effort:** S · **Depends on:** nothing · **Coordinate with:** a4 (same file)

## Problem

`ConfirmCloseModal` (`src/ConfirmCloseModal.ts:24-44`) sets no initial focus
and has no Enter path. The whole flow starts at a keystroke (`Cmd+W`), then
dead-ends into mouse territory: Enter does nothing predictable.

## Change

In `onOpen`, after building the buttons, focus the confirm button:

```ts
btn.setButtonText("Close tab")...
confirmBtn = btn;
...
confirmBtn.buttonEl.focus();
```

`ButtonComponent.buttonEl` is public API. With the confirm button focused:

- Enter/Space natively activate it — `Cmd+W → Enter` becomes a fluent
  "yes, really close".
- Tab reaches Cancel; Esc cancels via Modal's built-in handling.
- Screen readers announce the focused control.

**Do not** use `Modal.scope.register([], "Enter", …)` — a scope-level Enter
fires regardless of which element is focused, so a user who Tabs to Cancel and
presses Enter would race a native Cancel click against a scope-level confirm.
Focusing the button is pure platform behavior with zero new surface.

Focusing the destructive action by default is acceptable here because the
modal only appears in direct response to an explicit close command — Enter
matches expressed intent.

## Interaction with a4

a4 generalizes this modal (parameterized title/body/confirm label). Land a3
first (or in the same PR) and keep the focused-confirm behavior in the
generalized form.

## Verification

- e2e in `test/e2e/close-pinned.e2e.mjs`: open the modal via the close
  command, dispatch Enter over CDP, assert the tab closed; dispatch Esc in a
  second case, assert it survived.
- `npm run check`; `npm run build`; `xvfb-run -a npm run test:e2e`.
