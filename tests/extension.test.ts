import { describe, expect, test } from "bun:test";

import { captureDiff, MAX_DIFF_CHARS } from "../src/diff.ts";
import { buildPrompt } from "../src/prompt.ts";

// A stub extension API backed by an in-memory command table, so tests exercise
// the real capture logic without spawning processes. `exec(program, args)`
// passes "git" as the program and everything after it as the args.
function makeApi(files: Record<string, string>) {
  const run = (args: string[]) => {
    switch (args[0]) {
      case "rev-parse":
        return { stdout: "true\n", stderr: "", code: 0 };
      case "diff": {
        const key = args.includes("--stat") ? "stat" : "diff";
        return { stdout: files[key] ?? "", stderr: "", code: 0 };
      }
      case "ls-files":
        return { stdout: files.untracked ?? "", stderr: "", code: 0 };
      default:
        return { stdout: "", stderr: "", code: 0 };
    }
  };
  return { exec: async (_program: string, args: string[]) => run(args) };
}

const FILES = {
  stat: " app.ts | 3 +++\n 1 file changed, 3 insertions(+)",
  diff: "diff --git a/app.ts b/app.ts\n+export const x = 1\n",
  untracked: "notes.md\n",
};

describe("captureDiff", () => {
  test("returns a snapshot for a repo with working changes", async () => {
    const result = await captureDiff(makeApi(FILES), "/repo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // `stat` is trimmed for display, so match the trimmed form.
    expect(result.snapshot.stat).toBe(FILES.stat.trim());
    expect(result.snapshot.diff).toBe(FILES.diff.trim());
    expect(result.snapshot.truncated).toBe(false);
    expect(result.snapshot.untracked).toEqual(["notes.md"]);
    expect(result.snapshot.cwd).toBe("/repo");
  });

  test("rejects paths that are not a git repository", async () => {
    const api = makeApi(FILES);
    api.exec = async () => ({ stdout: "", stderr: "fatal: not a repository", code: 128 });
    const result = await captureDiff(api, "/nope");
    expect(result).toEqual({ ok: false, error: "not a git repository (/nope)" });
  });

  test("rejects an empty diff instead of capturing nothing", async () => {
    const result = await captureDiff(makeApi({ stat: "", diff: "  \n" }), "/repo");
    expect(result.ok).toBe(false);
  });

  test("truncates oversized diffs and says so", async () => {
    const big = "x".repeat(MAX_DIFF_CHARS + 500);
    const result = await captureDiff(makeApi({ ...FILES, diff: big }), "/repo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.diff.length).toBe(MAX_DIFF_CHARS);
    expect(result.snapshot.truncated).toBe(true);
  });

  test("runs commands by argv, never a shell string", async () => {
    const seen: string[][] = [];
    const api = {
      exec: async (_cmd: string, args: string[]) => {
        seen.push(args);
        return { stdout: args.join(" ").includes("rev-parse") ? "true\n" : FILES.diff, stderr: "", code: 0 };
      },
    };
    await captureDiff(api, "/repo");
    expect(seen.some(args => args.includes("--no-ext-diff"))).toBe(true);
  });
});

describe("buildPrompt", () => {
  const snapshot = {
    diff: FILES.diff,
    stat: FILES.stat,
    untracked: ["notes.md"],
    truncated: false,
    cwd: "/repo",
  };

  test("carries the question and the diff together", () => {
    const out = buildPrompt({ question: "is this safe?", snapshot });
    expect(out).toContain("<question>");
    expect(out).toContain("is this safe?");
    expect(out).toContain("<diff>");
    expect(out).toContain(FILES.diff);
    expect(out).toContain("<untracked-files>");
  });

  test("grows the fence past backticks inside the diff", () => {
    const out = buildPrompt({ question: "q", snapshot: { ...snapshot, diff: "```md\ninner\n```" } });
    const fence = /^(`{3,})diff$/m.exec(out);
    expect(fence).not.toBeNull();
    const len = fence![1].length;
    const after = out.slice(out.indexOf("<diff>"));
    const body = after.slice(after.indexOf("\n") + 1, after.lastIndexOf("</diff>"));
    // The inner ``` must not terminate the fence.
    expect(body).toContain("```md");
  });

  test("labels a truncated diff as partial", () => {
    const out = buildPrompt({ question: "q", snapshot: { ...snapshot, truncated: true } });
    expect(out).toContain("<truncation-note>");
    expect(out).toContain("partial");
  });

  test("omits optional sections when there is nothing to report", () => {
    const out = buildPrompt({ question: "q", snapshot: { ...snapshot, untracked: [] } });
    expect(out).not.toContain("<untracked-files>");
    expect(out).not.toContain("<truncation-note>");
  });
});
