# Improvement plans

One plan file per feature, each written to be executed independently (by a human
or an agent) on its own branch/PR. Every item was verified against the code as of
`main` at v1.3.1 — file/line references point at that state and should be
re-checked before implementing.

Effort: **S** = under half a day, **M** = 1–2 days.

## Part A — verified quick wins

| Plan | Title | Effort | Depends on |
| --- | --- | --- | --- |
| [a1](a1-focus-open-saved-group.md) | Focus instead of duplicating an already-open saved group | S | — |
| [a2](a2-block-mode-notice.md) | Notice feedback when block mode refuses a close | S | — |
| [a3](a3-confirm-modal-keyboard.md) | Keyboard-fluent confirm modal (focus the confirm button) | S | — (see note in a4) |
| [a4](a4-confirm-saved-group-delete.md) | Confirm before deleting a saved group | S | a3 (soft: generalizes the same modal) |
| [a5](a5-guard-commands-when-disabled.md) | Stop tab-group commands from silently mutating hidden state | S | — |
| [a6](a6-settings-structure.md) | Settings page structure, slider tooltip, dependent control | S | — |
| [a7](a7-saved-panel-polish.md) | Saved-groups panel: dead-end empty state, friendly member labels | S | — |
| [a8](a8-manifest-description.md) | Manifest/README describe all three features | S | — |

## Part B — ambitious features

| Plan | Title | Effort | Depends on |
| --- | --- | --- | --- |
| [b1](b1-close-guard-middle-click.md) | Middle-click and tab-× close protection | M | **Human sign-off required**; spike first |
| [b2](b2-protect-close-others.md) | Pinned-aware "Close others" / "Close this tab group" | M | b7 recommended first (shares enumeration helper) |
| [b3](b3-close-group-chip-actions.md) | "Close group" / "Save and close group" chip actions | S/M | a4 (generalized confirm modal) |
| [b4](b4-pin-whole-group.md) | Pin/unpin a whole group | S | — |
| [b5](b5-keyboard-group-navigation.md) | Keyboard group navigation and move commands | M | — |
| [b6](b6-open-saved-group-in-split-window.md) | Open a saved group in a split or new window | M | a1 (focus-if-open precedence) |
| [b7](b7-close-unpinned-in-group.md) | "Close all unpinned tabs in this tab group" command | S | — |
| [b8](b8-mobile-gating.md) | Mobile gating for tab-group settings | S | — |

## Dependency map

```
a3 ──(soft)──▶ a4 ──▶ b3
a1 ───────────────▶ b6
b7 ──(recommended)▶ b2
b1 ──▶ (blocked on human approval + spike S9)
everything else: independent
```

- **a3 → a4:** both touch `ConfirmCloseModal`. a4 generalizes it (parameterized
  title/body/confirm label); a3's focus-the-confirm-button behavior must be
  preserved in the generalized form. Land a3 first, or do both in one PR.
- **a4 → b3:** b3's pinned-member confirmation reuses the generalized modal.
- **a1 → b6:** b6 keeps a1's "focus if already open" as the uniform precedence
  rule for every open target, so a1's check must exist first.
- **b7 → b2 (recommended, not required):** both enumerate a strip's unpinned
  tabs and detach them; land b7 first and b2 reuses its helper.
- **b1** must not start until a human approves the capture-phase interception
  mechanism (CLAUDE.md prime directive 2) and spike S9 has determined which
  event Obsidian closes on.

## Recommended order

1. **Wave 1 (no approvals):** a1–a8, b7, b8 — any order except a3 before/with a4.
2. **Wave 2:** b3 + b4 (chip-menu cluster), then b5.
3. **Wave 3:** b1 (after sign-off + spike), then b2, b6.

## Ground rules (apply to every plan)

- `npm run check` green before every commit; `npm run build` for anything with
  runtime surface; e2e via `xvfb-run -a npm run test:e2e` where the plan says so.
- Non-trivial decision logic goes in `src/tabGroups/model.ts` (pure, unit-tested
  in `scripts/tabGroups.test.mjs`); Obsidian glue stays thin.
- Internal API only through the existing narrow guarded casts (`LeafInternal`,
  `TabsInternal`, `WorkspaceWithLeafById`), degrading to inert when absent.
- UI text is sentence case. Everything reverts on unload via `register*`.
- README (especially its "Scope" section) and settings descriptions are updated
  in the same PR as any behavior change.
