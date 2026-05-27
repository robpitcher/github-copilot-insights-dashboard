# Commit message instructions

These rules guide Copilot's commit-message generation in VS Code
(referenced by `github.copilot.chat.commitMessageGeneration.instructions`
in [.vscode/settings.json](../.vscode/settings.json)).

## Scope of changes

- **Summarize ALL staged changes**, not just the last file in the diff.
  When the diff is large, group related changes into themes and describe
  the overall intent in the subject line, with per-theme detail in the body.
- If changes span multiple areas (schema, ETL, API routes, UI, translations),
  pick the highest-level theme for the subject and list the sub-areas in the body.
- Never generate a message that only describes one file when multiple files
  are staged.

## Format

```text
type(scope): short imperative summary in lower case

1–3 sentences explaining what changed and why.
```

- **Subject line**: ≤ 72 characters **including** the `type(scope):` prefix
  plus the following space.
  If it would exceed that, shorten by dropping file lists, parentheticals,
  or trailing qualifiers — move the detail to the body.
- **Blank line** between subject and body (required for `git log --oneline`).
- **Body**: 1–3 short sentences explaining WHAT changed and WHY. Focus on
  user-visible impact and non-obvious reasoning, not a file-by-file diff list.
- Use **plain sentences separated by periods**, not bullet lists, unless
  there are 3+ distinct unrelated changes that genuinely warrant a list.
- **No trailing period** on the subject.

## Subject rules

- Never use `+`, `&`, or `and` in the subject to join two unrelated changes.
  If there are two changes, either split into two commits OR describe them
  as separate sentences in the body and pick the dominant one for the subject.
- Subject is **imperative mood, lowercase**: "add cache", not "Added cache"
  or "Adds cache".
- **Skip the body entirely** for trivial one-line changes
  (typo fixes, single-import additions, small reflows).

## Allowed types

`feat`, `fix`, `refactor`, `perf`, `build`, `ci`, `docs`, `test`, `chore`, `style`

## Forbidden

- Emojis in the subject or body.
- Co-author trailers (`Co-authored-by:`) unless a real collaborator pair-programmed.
- Issue/PR references (`Refs #123`, `Closes #45`) unless the issue is the
  literal subject of the change.
- File-by-file enumeration in the body — say what the change _does_, not which
  files moved.
- Mentioning the assistant or tool that generated the commit.
