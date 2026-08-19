# a8 — Manifest/README describe all three features

**Effort:** S · **Depends on:** nothing · **Ships with:** the next version bump

## Problem

`manifest.json:6` describes only the close-confirmation feature:

> "Confirms before closing a pinned tab via any close hotkey or command, so a
> stray keystroke can't lose your pinned tab."

The plugin now also ships compact pinned tabs and Chrome-style tab groups —
the bulk of the code, all six commands, and the ribbon icon. Users browsing
the community directory never learn those features exist.

## Change

1. `manifest.json` description — cover all three, within Obsidian's length
   conventions (aim ≤ 250 chars, plain sentence). Suggested:
   > "Protects pinned tabs from close hotkeys, shrinks them to compact icons,
   > and organizes tabs into Chrome-style named, colored, saveable groups."
2. `package.json` description — keep in sync (the repo's `validate` script
   checks manifest/package consistency for versions; keep descriptions
   aligned by convention).
3. README intro (first two paragraphs) — one-line mention of all three
   features up front, before the deep-dive sections that already exist.

## Constraints

- `npm run lint` runs `validate-manifest`; keep required fields intact.
- Community-directory listings pick up the new description only on the next
  release, so fold this into whichever PR lands first before a version bump —
  no dedicated release needed.

## Verification

- `npm run check` (manifest validation + `npm run validate` cross-file rules).
