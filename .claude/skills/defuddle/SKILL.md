---
name: defuddle
description: Extract clean markdown from normal web pages before saving research into the vault. Use for articles, blogs, documentation pages, or long web content where a reduced-noise markdown capture will save tokens and improve note quality.
version: 1.0.0
triggers:
  - defuddle
  - web to vault
  - clean markdown
  - article capture
  - doc capture
---

# Defuddle Skill

Prefer Defuddle-style cleaned markdown over noisy raw HTML when capturing normal web pages into Obsidian notes.

## When To Use

- Article ingestion
- Documentation capture
- Blog or research note capture
- Source material that should become a clean vault note

## Usage

```bash
defuddle parse "https://example.com/article" --md
defuddle parse "https://example.com/article" --md -o content.md
defuddle parse "https://example.com/article" -p title
defuddle parse "https://example.com/article" -p description
```

## Guidance

1. Prefer markdown output with `--md`.
2. Do not use this for URLs that already point directly to `.md`.
3. After extraction, store the cleaned markdown in the vault using Obsidian note structure rather than pasting raw page clutter.
