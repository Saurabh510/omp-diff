/**
 * Builds the user-visible prompt that carries the diff into the model's
 * immediate context window, so no terminal/bash tool call is ever needed.
 */

import type { DiffSnapshot } from "./diff.ts";

export interface PromptOptions {
  /** The question typed after `/diff`. */
  question: string;
  snapshot: DiffSnapshot;
}

/** Longest backtick run in `text`, used to size a fence that cannot close early. */
function longestFenceRun(text: string): number {
  let longest = 0;
  let current = 0;
  for (const char of text) {
    if (char === "`") {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}

/**
 * Wrap content in a fence guaranteed to be longer than any fence inside it, so
 * diff content containing backticks (Markdown docs, template strings) cannot
 * terminate the block and leak into the surrounding prompt.
 */
function fenced(text: string, lang = "diff"): string {
  const fence = "`".repeat(Math.max(3, longestFenceRun(text) + 1));
  return `${fence}${lang}\n${text}\n${fence}`;
}

/** Instructions kept deliberately short: the diff is the evidence, not a clue. */
const INSTRUCTIONS = [
  "- Use the diff above as the primary evidence for the answer.",
  "- Cite files and line ranges from the diff when you make claims.",
  "- Do not run `git diff` or re-derive the changes; they are already in this message.",
  "- Answer the question directly. Do not propose or apply edits unless asked.",
  "- If the diff does not contain the information needed to answer, say what is missing.",
];

/** Assemble the full prompt text. */
export function buildPrompt({ question, snapshot }: PromptOptions): string {
  const sections: string[] = [
    "You are answering a question about the working changes in this repository.",
    `Repository: ${snapshot.cwd}`,
    "",
    "<question>",
    question,
    "</question>",
    "",
    "<diff-summary>",
    snapshot.stat,
    "</diff-summary>",
    "",
    "<diff>",
    fenced(snapshot.diff),
    "</diff>",
  ];

  if (snapshot.untracked.length > 0) {
    sections.push("", "<untracked-files>", snapshot.untracked.join("\n"), "</untracked-files>");
  }

  if (snapshot.truncated) {
    sections.push(
      "",
      "<truncation-note>",
      `The diff above was truncated and is therefore partial. Do not treat it as the complete ` +
        `change set. If the question depends on the omitted portion, say so and read the specific ` +
        `files instead of guessing.`,
      "</truncation-note>",
    );
  }

  sections.push("", "<instructions>", ...INSTRUCTIONS, "</instructions>");

  return sections.join("\n");
}
