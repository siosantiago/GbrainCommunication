import readline from "node:readline/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";
import { AgentConfig } from "./types.js";
import { readJson, writeJson } from "./storage.js";
import { GBrainClient } from "./gbrain.js";
import { AgentLogger } from "./logger.js";
import { renderWelcome } from "./display.js";

const configFile = "config.json";
const profileFile = "profile.json";
const execFileAsync = promisify(execFile);

export async function loadConfigSafe(): Promise<AgentConfig> {
  const existing = await readJson<AgentConfig | null>(configFile, null);
  const fromEnv = configFromEnv();
  return {
    gbrainApiKey: fromEnv.gbrainApiKey || existing?.gbrainApiKey || "",
    primitiveApiKey: fromEnv.primitiveApiKey || existing?.primitiveApiKey || "",
    primitiveWebhookSecret: fromEnv.primitiveWebhookSecret ?? existing?.primitiveWebhookSecret,
    primitiveFrom: fromEnv.primitiveFrom || existing?.primitiveFrom || "",
    anthropicApiKey: fromEnv.anthropicApiKey ?? existing?.anthropicApiKey,
    gbrainBaseUrl: fromEnv.gbrainBaseUrl ?? existing?.gbrainBaseUrl,
    webhookPort: fromEnv.webhookPort ?? existing?.webhookPort,
  };
}

export async function loadOrSetupConfig(logger: AgentLogger): Promise<AgentConfig> {
  const existing = await readJson<AgentConfig | null>(configFile, null);
  const fromEnv = configFromEnv();

  if (existing?.gbrainApiKey && existing.primitiveApiKey && existing.primitiveFrom) {
    return { ...existing, ...emptyFields(fromEnv) };
  }

  if (!process.stdin.isTTY) {
    const demo = {
      gbrainApiKey: fromEnv.gbrainApiKey || "demo_gbrain",
      primitiveApiKey: fromEnv.primitiveApiKey || "prim_demo",
      primitiveWebhookSecret: fromEnv.primitiveWebhookSecret,
      primitiveFrom: fromEnv.primitiveFrom || "agent@demo.primitive.example",
      anthropicApiKey: fromEnv.anthropicApiKey,
      gbrainBaseUrl: fromEnv.gbrainBaseUrl,
      webhookPort: fromEnv.webhookPort,
    };
    await writeJson(configFile, demo);
    return demo;
  }

  renderWelcome();
  const rl = readline.createInterface({ input, output });
  try {
    const gbrainApiKey = fromEnv.gbrainApiKey || (await secretPrompt(rl, "Step 1/3: Paste your GBrain API key: "));
    const primitiveApiKey = fromEnv.primitiveApiKey || (await secretPrompt(rl, "Step 2/3: Paste your Primitive API key: "));
    const primitiveFrom =
      fromEnv.primitiveFrom ||
      (await rl.question(
        "Step 2b/3: Primitive sender address (e.g. agent@your-subdomain.primitive.email): ",
      ));

    const config: AgentConfig = {
      gbrainApiKey,
      primitiveApiKey,
      primitiveFrom: primitiveFrom.trim(),
      primitiveWebhookSecret: fromEnv.primitiveWebhookSecret,
      anthropicApiKey: fromEnv.anthropicApiKey,
      gbrainBaseUrl: fromEnv.gbrainBaseUrl,
      webhookPort: fromEnv.webhookPort,
    };

    const validGbrain = await new GBrainClient(config, logger).validate();
    console.log(`${validGbrain ? chalk.green("✓") : chalk.yellow("!")} GBrain key ${validGbrain ? "validated" : "stored; live validation unavailable"}`);
    console.log(`${chalk.green("✓")} Primitive key stored`);

    await writeJson(configFile, config);
    return config;
  } finally {
    rl.close();
  }
}

function configFromEnv(): AgentConfig {
  return {
    gbrainApiKey: process.env.GBRAIN_API_KEY ?? "",
    primitiveApiKey: process.env.PRIMITIVE_API_KEY ?? "",
    primitiveWebhookSecret: process.env.PRIMITIVE_WEBHOOK_SECRET,
    primitiveFrom: process.env.PRIMITIVE_FROM ?? process.env.PRIMITIVE_EMAIL ?? "",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    gbrainBaseUrl: process.env.GBRAIN_BASE_URL,
    webhookPort: process.env.GBRAIN_WEBHOOK_PORT ? Number(process.env.GBRAIN_WEBHOOK_PORT) : undefined,
  };
}

function emptyFields(config: AgentConfig): Partial<AgentConfig> {
  return Object.fromEntries(Object.entries(config).filter(([, value]) => value)) as Partial<AgentConfig>;
}

async function secretPrompt(rl: readline.Interface, prompt: string): Promise<string> {
  const value = await rl.question(prompt);
  return value.trim();
}

export async function loadOrCreateProfile(): Promise<void> {
  const existing = await readJson<Record<string, unknown> | null>(profileFile, null);
  if (existing && Object.keys(existing).length > 0) {
    return;
  }
  if (!process.stdin.isTTY) {
    return;
  }

  if (await isGBrainCliInstalled()) {
    return;
  }

  console.log("");
  console.log(chalk.bold("Profile setup") + chalk.dim(" (used for matching — gbrain CLI not detected)"));
  const rl = readline.createInterface({ input, output });
  try {
    const currentWork = (await rl.question("  What are you working on? ")).trim();
    const skillsAnswer = (await rl.question("  Skills you can offer (comma-separated): ")).trim();
    const needsAnswer = (await rl.question("  What are you looking for (comma-separated): ")).trim();
    const domain = (await rl.question("  What domain or area do you care about most? ")).trim();

    const skills = splitList(skillsAnswer);
    const needs = splitList(needsAnswer);
    const summary = [
      currentWork && `Working on ${currentWork}.`,
      skills.length && `Can offer ${skills.join(", ")}.`,
      needs.length && `Looking for ${needs.join(", ")}.`,
      domain && `Focused on ${domain}.`,
    ]
      .filter(Boolean)
      .join(" ");

    const profile = {
      current_work: currentWork,
      skills,
      needs,
      domain,
      summary,
      interests: domain ? [domain] : [],
      projects: currentWork ? [currentWork] : [],
      cares_about: domain ? [domain] : [],
      _source: "wizard" as const,
    };

    await writeJson(profileFile, profile);
    console.log(`${chalk.green("✓")} Profile saved to state/profile.json`);
    console.log("");
  } finally {
    rl.close();
  }
}

function splitList(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function isGBrainCliInstalled(): Promise<boolean> {
  try {
    await execFileAsync("gbrain", ["--version"], { timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}
