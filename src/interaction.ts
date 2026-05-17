import readline from "node:readline";
import chalk from "chalk";
import { MatchResult, SandboxResult } from "./types.js";
import { requestUpgrade } from "./trust.js";
import { colorPseudonym } from "./display.js";

export function startInteraction(matches: MatchResult[], sandboxes: SandboxResult[]): () => void {
  if (!process.stdin.isTTY || !matches.length) {
    return () => undefined;
  }

  let idx = 0;

  function showCurrent(): void {
    const m = matches[idx];
    const brief = sandboxes.find((s) => s.peerId === m.peerId)?.brief;
    console.log("");
    console.log(
      `${chalk.bold(`[${idx + 1}/${matches.length}]`)} ${colorPseudonym(m.pseudonym)}  ${chalk.yellow(`Score: ${m.score}`)}`,
    );
    console.log(`  ${chalk.dim("Collab:")} ${m.collaboration.slice(0, 80)}`);
    if (brief) {
      console.log(`  ${chalk.dim("Brief:")} ${brief.title}`);
    }
    console.log(
      chalk.dim("  N next  ·  T tier-2  ·  R read brief  ·  P pass  ·  Ctrl+C exit"),
    );
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  showCurrent();

  const handler = async (_ch: string, key: readline.Key) => {
    if (!key) return;
    const m = matches[idx];

    if (key.ctrl && key.name === "c") {
      cleanup();
      process.exit(0);
    }

    if (key.name === "n" || key.name === "right") {
      idx = (idx + 1) % matches.length;
      showCurrent();
      return;
    }

    if (key.name === "t") {
      const record = await requestUpgrade(m.peerId, m.pseudonym, 2);
      console.log(`  ${chalk.green("✓")} Tier 2 unlocked for ${colorPseudonym(m.pseudonym)} ${chalk.dim(`(tier: ${record.tier})`)}`);
      console.log(`  ${chalk.dim("Collaboration:")} ${m.collaboration}`);
      if (m.reasons.length) {
        for (const r of m.reasons.slice(0, 3)) console.log(`  ${chalk.blue("→")} ${chalk.dim(r)}`);
      }
      return;
    }

    if (key.name === "r") {
      const brief = sandboxes.find((s) => s.peerId === m.peerId)?.brief;
      if (brief) {
        console.log("");
        console.log(chalk.bold(brief.title));
        console.log(brief.whatWeWouldBuild);
        console.log(chalk.dim(`Contributions: ${brief.eachContributes.join(" · ")}`));
      } else {
        console.log(chalk.dim("  No brief available for this match yet."));
      }
      return;
    }

    if (key.name === "p") {
      console.log(chalk.dim(`  Passed on ${m.pseudonym}.`));
      if (matches.length > 1) {
        idx = (idx + 1) % matches.length;
        showCurrent();
      }
      return;
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
