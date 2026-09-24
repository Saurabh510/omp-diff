/**
 * /diff for omp — ask a custom question with the active git diff injected.
 *
 * The extension command captures the working changes and delivers them inside a
 * single user message, so the model answers from context it already holds
 * instead of spending turns on a terminal/bash tool call loop.
 *
 * Type imports are intentionally omitted: pi and omp publish the same extension
 * API under different package names, and this package stays usable in both.
 */

import { captureDiff } from "./diff.ts";
import { buildPrompt } from "./prompt.ts";

const USAGE = "Usage: /diff <your question> (e.g. /diff explain what changed)";

export interface CommandContext {
  cwd: string;
  ui?: { notify?: (message: string, level?: string) => unknown };
}

export interface ExtensionApi {
  registerCommand(
    name: string,
    command: { description: string; handler: (args: string, ctx: CommandContext) => Promise<void> },
  ): void;
  sendUserMessage(content: string): Promise<void>;
  exec(command: string, args: string[], options: { cwd: string }): Promise<unknown>;
}

export default function diff(pi: ExtensionApi): void {
  pi.registerCommand("diff", {
    description: "Ask a custom question with the active git diff injected as context",

    handler: async (args: string, ctx: CommandContext) => {
      const question = String(args ?? "").trim();

      // Runtime actions are unavailable while the module is loading, so every
      // pi.* call lives inside the handler rather than at registration time.
      if (!question) {
        ctx.ui?.notify?.(USAGE, "warn");
        return;
      }

      const result = await captureDiff(pi, ctx.cwd);

      if (!result.ok) {
        ctx.ui?.notify?.(`/diff: ${result.error}`, "error");
        return;
      }

      // Delivering as one user message puts the diff into the immediate context
      // window for this turn, bypassing the terminal/bash execution loop.
      await pi.sendUserMessage(buildPrompt({ question, snapshot: result.snapshot }));
    },
  });
}
