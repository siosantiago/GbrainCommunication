import chalk from "chalk";
import { AgentConfig, Identity, MatchResult, SandboxResult, TrustTier } from "./types.js";
import { ProfileSource } from "./gbrain.js";
import { trustLabel } from "./trust.js";

const width = 76;

function pad(line: string): string {
  const visible = line.replace(/\u001b\[[0-9;]*m/g, "");
  if (visible.length >= width - 4) {
    return `${line.slice(0, width - 7)}...`;
  }
  return `${line}${" ".repeat(width - 4 - visible.length)}`;
}

export function renderWelcome(): void {
  console.log(chalk.bold("\nWelcome to GBrain Network"));
  console.log(chalk.dim("Let's get your agent running in under 60 seconds.\n"));
}

export function renderSetupComplete(identity: Identity, stats: string, primitiveFrom: string): void {
  console.log(`${chalk.green("✓")} GBrain profile loaded ${chalk.dim(stats)}`);
  console.log(`${chalk.green("✓")} Primitive email active ${chalk.dim(`(${primitiveFrom})`)}`);
  console.log(`${chalk.green("✓")} mDNS broadcasting ${chalk.dim("(_gbrain._tcp)")}`);
  console.log(`${chalk.green("✓")} Encryption keys generated ${chalk.dim("(x25519 ephemeral keypair)")}`);
  console.log("");
  console.log(`${chalk.bold("Your agent is live.")} ${chalk.dim("Scanning for nearby agents...")}`);
  console.log(`${chalk.dim("  Flags: --silent (quiet mode) · --logs (debug output)")}`);
  console.log(`${chalk.dim("  Pseudonym:")} ${colorPseudonym(identity.pseudonym)}\n`);
}

export function colorPseudonym(pseudonym: string): string {
  return chalk.hex("#BC8CFF").bold(pseudonym);
}

export function renderProgress(completed: number, total: number): string {
  const length = 12;
  const ratio = total === 0 ? 0 : completed / total;
  const filled = Math.round(ratio * length);
  return `${chalk.blue("█".repeat(filled))}${chalk.dim("░".repeat(length - filled))} ${completed}/${total} complete`;
}

export function trustMeter(tier: TrustTier): string {
  return [1, 2, 3]
    .map((value) => (value <= tier ? chalk.green("■") : chalk.dim("□")))
    .join("");
}

export function renderMatchCard(rank: number, match: MatchResult, sandbox?: SandboxResult): void {
  const headerColor = rank === 1 ? chalk.yellow : chalk.magenta;
  const header = `${rank === 1 ? "#1" : `#${rank}`} — ${match.pseudonym}    Score: ${match.score}`;
  console.log(`┌${"─".repeat(width - 2)}┐`);
  console.log(`│ ${pad(headerColor.bold(header))} │`);
  console.log(`├${"─".repeat(width - 2)}┤`);
  console.log(`│ ${pad(chalk.bold(`Collaboration: ${match.collaboration}`))} │`);
  console.log(`│ ${pad(`${chalk.dim("They bring:")} ${match.theyBring.join(" + ")}`)} │`);
  console.log(`│ ${pad(`${chalk.dim("You bring:")} ${match.youBring.join(" + ")}`)} │`);
  console.log(`│ ${pad("")} │`);
  console.log(`│ ${pad(chalk.dim("Why you match (from GBrain):"))} │`);
  for (const reason of match.reasons.slice(0, 4)) {
    console.log(`│ ${pad(`${chalk.blue("→")} ${chalk.dim(reason)}`)} │`);
  }
  if (sandbox) {
    console.log(`│ ${pad("")} │`);
    console.log(`│ ${pad(`${chalk.dim("Brief:")} ${sandbox.brief.title}`)} │`);
  }
  console.log(`│ ${pad(`${chalk.dim("Trust:")} ${trustMeter(match.trustTier)} ${chalk.dim(trustLabel(match.trustTier))}`)} │`);
  console.log(`├${"─".repeat(width - 2)}┤`);
  console.log(
    `│ ${pad(`${key("T")} Upgrade to Tier 2   ${key("R")} Read full brief   ${key("Y")} Meet   ${key("P")} Pass`)} │`,
  );
  console.log(`└${"─".repeat(width - 2)}┘`);
}

export function renderResults(matches: MatchResult[], sandboxes: SandboxResult[]): void {
  console.log("");
  console.log(chalk.blue.bold(`YOUR AGENTS HAVE BEEN BUSY — ${sandboxes.length} sandboxed collaborations completed`));
  console.log("");
  const sandboxByPeer = new Map(sandboxes.map((sandbox) => [sandbox.peerId, sandbox]));
  matches
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .forEach((match, index) => renderMatchCard(index + 1, match, sandboxByPeer.get(match.peerId)));
}

function key(value: string): string {
  return `${chalk.bgGray.white(` ${value} `)}`;
}

export function profileStatsLabel(source: ProfileSource): string {
  if (source === "local-brain") return "(from local brain)";
  if (source === "cached") return "(from cached profile)";
  if (source === "wizard") return "(from wizard)";
  if (source === "remote-api") return "(from remote API)";
  if (source === "demo") return "(demo mode)";
  return `(from ${source})`;
}

export function renderWebhookHint(_config: AgentConfig, port: number): void {
  console.log(
    `${chalk.dim("  Webhook on :")}${port}${chalk.dim(" — run ")}${chalk.cyan(`ngrok http ${port}`)}${chalk.dim(" and paste URL into Primitive dashboard")}`,
  );
}
