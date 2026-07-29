---
name: json-canvas
description: Create and edit Obsidian JSON Canvas files with nodes, edges, groups, and note references. Use when the user works with .canvas files, visual maps, note boards, or relationship diagrams inside Obsidian.
version: 1.0.0
triggers:
  - json canvas
  - obsidian canvas
  - .canvas
  - note board
---

# JSON Canvas Skill

Use valid JSON Canvas structure when creating or editing `.canvas` files for Obsidian.

## Core Objects

- `nodes`
- `edges`
- optional grouping metadata

## Guidance

1. Keep IDs stable when editing an existing canvas.
2. Use note/file references consistently so canvas nodes still point to the correct vault content.
3. Preserve canvas readability by avoiding unnecessary coordinate churn.
4. When possible, mirror the note structure already present in the vault.
