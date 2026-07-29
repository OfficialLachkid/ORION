---
name: obsidian-cli
description: Interact with a running Obsidian vault through the Obsidian CLI to read, search, create, append, and inspect notes. Use when the user asks to operate on the vault from the desktop app or when plugin/theme debugging inside Obsidian is needed.
version: 1.0.0
triggers:
  - obsidian cli
  - obsidian vault
  - search vault
  - create note
  - append note
---

# Obsidian CLI Skill

Use the `obsidian` CLI when the Obsidian desktop app is open and the task should operate against the live vault rather than only editing files on disk.

## Command Style

- Parameters use `name=value`.
- Quote values with spaces.
- Use `vault=` first when targeting a specific vault.

## Common Commands

```bash
obsidian search query="website builder"
obsidian read file="Production_Next_Steps"
obsidian create name="New Note" content="# Hello" silent
obsidian append file="Daily Notes" content="- [ ] Follow up"
obsidian property:set file="Project Note" name="status" value="active"
```

## Guidance

1. Prefer `file=` when the note name is known and unique.
2. Prefer `path=` when exact vault path matters.
3. Use `silent` when you do not want Obsidian to jump focus to the edited note.
4. If the command depends on a specific vault, pass `vault="Jacobs-2"` or the real vault name explicitly.

## Plugin / Theme Debugging

```bash
obsidian plugin:reload id=my-plugin
obsidian dev:errors
obsidian dev:screenshot path=debug.png
obsidian dev:dom selector=".workspace-leaf" text
obsidian dev:console level=error
```
