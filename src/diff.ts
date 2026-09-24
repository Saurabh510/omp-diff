/**
 * git plumbing for the extension: runs `git diff` and ships a normalized snapshot.
 *
 * Every subprocess goes through argv (never a shell string), so a path or a
 * question containing metacharacters cannot be reinterpreted by a shell.
 */

/** Diffs larger than this are truncated before injection. */
export const MAX_DIFF_CHARS = 120_000;

/** The subset of the omp extension API this package needs to run a command. */
export interface ExecApi {
  exec(command: string, args: string[], options: { cwd: string }): Promise<unknown>;
}

/** A normalized subprocess result. */
export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Everything the prompt template needs, already validated. */
export interface DiffSnapshot {
  /** Full `git diff HEAD` output (may be truncated). */
  diff: string;
  /** Human-readable `--stat` overview. */
  stat: string;
  /** Untracked paths, best effort; empty when git did not report any. */
  untracked: string[];
  /** True when {@link diff} was cut at {@link MAX_DIFF_CHARS}. */
  truncated: boolean;
  /** Working directory the commands ran in. */
  cwd: string;
}

export type CaptureResult = { ok: true; snapshot: DiffSnapshot } | { ok: false; error: string };

/** Coerce a runtime result object into the shape we consume. */
function normalize(result: unknown): RunResult {
  const record = (result ?? {}) as Partial<RunResult> & { exitCode?: number };
  return {
    stdout: String(record.stdout ?? ""),
    stderr: String(record.stderr ?? ""),
    code: Number(record.code ?? record.exitCode ?? 0),
  };
}

/** Run one command, tolerating a non-zero exit so the caller can diagnose it. */
async function run(api: ExecApi, argv: string[], cwd: string): Promise<RunResult> {
  const [command, ...args] = argv;
  return normalize(await api.exec(command, args, { cwd }));
}

/**
 * Collect the active working changes.
 *
 * `git diff HEAD` is the union of staged and unstaged edits relative to the last
 * commit. Untracked files never appear in a diff, so they are listed separately
 * as best-effort context rather than silently dropped.
 */
export async function captureDiff(api: ExecApi, cwd: string): Promise<CaptureResult> {
  const repo = await run(api, ["git", "rev-parse", "--is-inside-work-tree"], cwd);
  if (repo.code !== 0 || repo.stdout.trim() !== "true") {
    return { ok: false, error: `not a git repository (${cwd})` };
  }

  const [stat, full, untracked] = await Promise.all([
    run(api, ["git", "diff", "HEAD", "--stat", "--no-color"], cwd),
    run(api, ["git", "diff", "HEAD", "--no-color", "--no-ext-diff"], cwd),
    run(api, ["git", "ls-files", "--others", "--exclude-standard"], cwd),
  ]);

  if (full.code !== 0) {
    const detail = (full.stderr || full.stdout).trim() || "unknown git error";
    return { ok: false, error: `git diff failed — ${detail}` };
  }

  const diff = full.stdout.trim();
  if (!diff) {
    return { ok: false, error: "no staged or unstaged changes to inspect" };
  }

  return {
    ok: true,
    snapshot: {
      diff: diff.length > MAX_DIFF_CHARS ? diff.slice(0, MAX_DIFF_CHARS) : diff,
      stat: stat.stdout.trim() || "(stat unavailable)",
      untracked: untracked.code === 0 ? splitLines(untracked.stdout) : [],
      truncated: diff.length > MAX_DIFF_CHARS,
      cwd,
    },
  };
}

/** Split command output into non-empty, trimmed lines. */
function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);
}
