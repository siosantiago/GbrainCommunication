import { readdir, rm } from "node:fs/promises";
import chalk from "chalk";
import { ensureStateDir, statePath } from "./storage.js";

export interface ResetOptions {
  keepIdentity?: boolean;
  keepConfig?: boolean;
}

const identityFiles = new Set(["identity.json", "crypto_identity.json"]);
const configFiles = new Set(["config.json"]);

export async function resetState(options: ResetOptions = {}): Promise<string[]> {
  await ensureStateDir();
  const dir = statePath(".");
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    if (options.keepIdentity && identityFiles.has(entry)) continue;
    if (options.keepConfig && configFiles.has(entry)) continue;
    await rm(statePath(entry), { force: true });
    removed.push(entry);
  }
  return removed;
}

export function renderResetReport(removed: string[], options: ResetOptions): void {
  if (!removed.length) {
    console.log(chalk.dim("No state files to clear."));
    return;
  }
  console.log(`${chalk.green("✓")} Cleared ${removed.length} state file(s):`);
  for (const file of removed) {
    console.log(`   ${chalk.dim("·")} ${file}`);
  }
  if (options.keepIdentity) {
    console.log(chalk.dim("  (kept identity + crypto keypair)"));
  }
  if (options.keepConfig) {
    console.log(chalk.dim("  (kept config.json)"));
  }
}
