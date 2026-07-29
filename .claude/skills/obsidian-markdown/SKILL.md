---
name: obsidian-markdown
description: Create and edit Obsidian Flavored Markdown with wikilinks, embeds, callouts, frontmatter properties, tags, comments, and note-to-note structure. Use when working with vault .md files or when the user mentions Obsidian notes, wikilinks, callouts, aliases, tags, or embeds.
version: 1.0.0
triggers:
  - obsidian markdown
  - wikilink
  - callout
  - frontmatter
  - vault note
---

# Obsidian Markdown Skill

Use Obsidian-flavored Markdown instead of plain Markdown when editing notes inside a vault.

## Rules

1. Use YAML frontmatter for note metadata such as `title`, `tags`, and `aliases`.
2. Use `[[Note Name]]` for links between notes in the same vault.
3. Use `![[Note Name]]` or `![[asset.png]]` for embeds.
4. Use callouts like `> [!note]` or `> [!warning]` for highlighted note sections.
5. Use normal Markdown links only for external URLs.

## Common Patterns

```markdown
---
title: Example Note
tags:
  - project
  - active
aliases:
  - Alternate Name
---

# Example Note

Related: [[Another Note]]

> [!note]
> This is an Obsidian callout.

![[Architecture Diagram.png]]
```

## Additional Conventions

- Use `==highlight==` for highlight formatting.
- Use `%% hidden comment %%` for Obsidian comments.
- Use checklist syntax `- [ ]` and `- [x]` for task tracking.
- Keep note names stable and readable so wikilinks stay useful across the vault.
