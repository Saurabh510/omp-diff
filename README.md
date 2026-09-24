# omp-diff — `/diff`

Ask a custom question with the active git diff injected straight into the model's context.

```
/diff explain what changed
/diff is this safe to ship?
/diff what did I forget to handle here?
```

The extension runs `git diff` itself and hands the result to the model inside the
same prompt. You answer your question; the agent never spends turns on a
terminal round-trip.

## Why an extension and not a slash command

`omp`'s `.md` slash commands are pure text templates — `$ARGUMENTS` substitution
plus a fixed set of render helpers. None of them can execute a shell, so the
model would have to call `bash` to read the diff, then answer. That is the exact
round-trip this plugin removes.

## Install

```bash
omp plugin link /path/to/omp-diff
```

or for a single local session:

```bash
omp -e /path/to/omp-diff/src/index.ts
```

Then restart the session (extension modules are not hot-reloaded) and run
`/diff <question>`.

## What gets captured

| Source                     | Purpose                                            |
| -------------------------- | -------------------------------------------------- |
| `git diff HEAD --stat`     | Orientation: which files, how big                  |
| `git diff HEAD`            | Staged **and** unstaged changes vs. the last commit |
| `git ls-files --others`    | Untracked files, listed separately                  |

Untracked content never appears in a diff, so those files are listed by name
rather than being silently dropped. You are told when the question needs content
the diff cannot show.

## Behavior worth knowing

- **Truncation** — diffs over 120,000 characters are cut, and the prompt says so.
  A truncated diff is labelled partial so the model will not answer as if it saw
  everything.
- **Fence safety** — the diff is wrapped in a fence longer than any backtick run
  inside it, so diffs containing ```` ``` ```` blocks cannot escape their block.
- **No shell** — every command runs by argv, so paths and questions containing
  shell metacharacters are never interpreted.
- **Failure is cheap** — not a repository, no changes, or a failed `git diff`
  produces a status notice and no model call.

## Development

```bash
bun test      # unit tests for capture + prompt assembly
bun run check # typecheck
```

## License

MIT
