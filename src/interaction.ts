import readline from "node:readline";
import chalk from "chalk";
import { MatchResult, SandboxResult, TrustTier } from "./types.js";

export type RequestTrustUpgrade = (peerId: string, tier: TrustTier) => Promise<void>;

export function startInteraction(
  matches: MatchResult[],
  sandboxes: SandboxResult[],
  requestTrustUpgrade: RequestTrustUpgrade,
): () => void {
  if (!process.stdin.isTTY || !matches.length) {
    return () => undefined;
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  console.log(chalk.dim("Press T to request Tier 2 · R to read top brief · Y to meet/reveal · P to pass · Ctrl+C to exit"));

  const handler = async (_: string, key: readline.Key) => {
    const top = matches[0];
    if (key.ctrl && key.name === "c") {
      cleanup();
      process.exit(0);
    }
    if (key.name === "t") {
      await requestTrustUpgrade(top.peerId, 2);
      console.log(`${chalk.green("✓")} Tier 2 request sent to ${top.pseudonym} via Primitive. Mutual consent required.`);
    }
    if (key.name === "r") {
      const brief = sandboxes.find((sandbox) => sandbox.peerId === top.peerId)?.brief;
      if (brief) {
        console.log(chalk.bold(`\n${brief.title}`));
        console.log(brief.whatWeWouldBuild);
        console.log(chalk.dim(`Contributions: ${brief.eachContributes.join(" · ")}`));
      }
    }
    if (key.name === "y") {
      await requestTrustUpgrade(top.peerId, 3);
      console.log(`${chalk.green("✓")} Tier 3 reveal request sent to ${top.pseudonym} via Primitive.`);
    }
    if (key.name === "p") {
      console.log(chalk.dim(`Passed on ${top.pseudonym}.`));
    }
  };

  process.stdin.on("keypress", handler);
  const cleanup = () => {
    process.stdin.off("keypress", handler);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  };
  return cleanup;
}
