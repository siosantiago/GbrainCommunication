import readline from "node:readline/promises";
import { unlink } from "node:fs/promises";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";
import { AgentConfig } from "./types.js";
import { readJson, writeJson, statePath } from "./storage.js";
import { GBrainClient } from "./gbrain.js";
import { AgentLogger, createLogger } from "./logger.js";
import { renderWelcome } from "./display.js";

const configFile = "config.json";
const profileFile = "profile.json";

export async function loadOrSetupConfig(logger: AgentLogger): Promise<AgentConfig> {
  const existing = await readJson<AgentConfig | null>(configFile, null);
  const fromEnv = configFromEnv();

  if (existing?.primitiveApiKey && existing.primitiveFrom) {
    // Merge env overrides; save if new fields arrived via env
    const merged: AgentConfig = { ...existing, ...emptyFields(fromEnv) };
    if (!existing.llmApiKey && merged.llmApiKey) {
      await writeJson(configFile, merged);
    }
    return merged;
  }

  // If .env has all required fields, skip the wizard entirely
  if (fromEnv.primitiveApiKey && fromEnv.primitiveFrom) {
    return buildFromEnv(fromEnv, logger);
  }

  if (!process.stdin.isTTY) {
    const demo: AgentConfig = {
      gbrainApiKey: fromEnv.gbrainApiKey || "demo_gbrain",
      primitiveApiKey: fromEnv.primitiveApiKey || "prim_demo",
      primitiveWebhookSecret: fromEnv.primitiveWebhookSecret,
      primitiveFrom: fromEnv.primitiveFrom || "agent@demo.primitive.example",
      llmApiKey: fromEnv.llmApiKey,
      gbrainBaseUrl: fromEnv.gbrainBaseUrl,
      webhookPort: fromEnv.webhookPort,
    };
    await writeJson(configFile, demo);
    return demo;
  }

  return runWizard(logger, fromEnv);
}

export async function reconfigureAgent(logger: AgentLogger): Promise<AgentConfig> {
  try {
    await unlink(statePath(configFile));
  } catch {
    // fine if it doesn't exist
  }
  const fromEnv = configFromEnv();
  // If .env has all required fields, skip the interactive wizard
  if (fromEnv.primitiveApiKey && fromEnv.primitiveFrom) {
    return buildFromEnv(fromEnv, logger);
  }
  return runWizard(logger, fromEnv);
}

async function buildFromEnv(fromEnv: AgentConfig, logger: AgentLogger): Promise<AgentConfig> {
  const config: AgentConfig = {
    gbrainApiKey: fromEnv.gbrainApiKey || "demo_gbrain",
    primitiveApiKey: fromEnv.primitiveApiKey,
    primitiveFrom: fromEnv.primitiveFrom,
    llmApiKey: fromEnv.llmApiKey,
    primitiveWebhookSecret: fromEnv.primitiveWebhookSecret,
    webhookPort: fromEnv.webhookPort ?? 64320,
    gbrainBaseUrl: fromEnv.gbrainBaseUrl,
  };
  await writeJson(configFile, config);
  const validGbrain = await new GBrainClient(config, logger).validate();
  console.log(`${chalk.green("✓")} Config loaded from .env`);
  console.log(`  from:    ${config.primitiveFrom}`);
  console.log(`  LLM:     ${config.llmApiKey ? "set" : chalk.yellow("not set — profile parsing will use demo mode")}`);
  console.log(`  port:    ${config.webhookPort}`);
  if (!validGbrain) console.log(chalk.dim("  GBrain key: live validation unavailable"));
  return config;
}

async function runWizard(logger: AgentLogger, fromEnv: AgentConfig): Promise<AgentConfig> {
  renderWelcome();
  const rl = readline.createInterface({ input, output });
  try {
    const primitiveApiKey =
      fromEnv.primitiveApiKey || (await secretPrompt(rl, chalk.bold("Step 1/5") + " Primitive API key (prim_...): "));

    const primitiveFrom =
      fromEnv.primitiveFrom ||
      (await rl.question(
        chalk.bold("Step 2/5") + " Primitive sender address (e.g. agent@dry-breeze.primitive.email): ",
      ));

    const llmInput = fromEnv.llmApiKey
      ? ""
      : (await secretPrompt(rl, chalk.bold("Step 3/5") + " LLM API key (sk-ant-... for Claude, sk-... for OpenAI — for profile parsing + matching): "));
    const llmApiKey = fromEnv.llmApiKey || llmInput || undefined;

    const portInput = await rl.question(chalk.bold("Step 4/5") + " Webhook port [64320]: ");
    const webhookPort = portInput.trim() ? Number(portInput.trim()) : 64320;

    const webhookSecretInput =
      fromEnv.primitiveWebhookSecret ||
      (await secretPrompt(
        rl,
        chalk.bold("Step 5/5") + " Primitive webhook secret (from dashboard → domain → Webhooks — Enter to skip): ",
      ));
    const primitiveWebhookSecret = webhookSecretInput || undefined;

    const config: AgentConfig = {
      gbrainApiKey: fromEnv.gbrainApiKey || "demo_gbrain",
      primitiveApiKey: primitiveApiKey.trim(),
      primitiveFrom: primitiveFrom.trim(),
      llmApiKey,
      primitiveWebhookSecret,
      webhookPort,
      gbrainBaseUrl: fromEnv.gbrainBaseUrl,
    };

    const validGbrain = await new GBrainClient(config, logger).validate();
    console.log(
      `${validGbrain ? chalk.green("✓") : chalk.yellow("!")} GBrain key ${validGbrain ? "validated" : "stored; live validation unavailable"}`,
    );
    console.log(`${chalk.green("✓")} Primitive key stored`);
    if (llmApiKey) console.log(`${chalk.green("✓")} LLM key stored`);

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
    llmApiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY,
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

export async function loadOrCreateProfile(config?: AgentConfig): Promise<void> {
  const existing = await readJson<Record<string, unknown> | null>(profileFile, null);
  if (existing && Object.keys(existing).length > 0) {
    return;
  }
  if (!process.stdin.isTTY) {
    return;
  }

  // Try gbrain first — if profile page exists, use it and skip the wizard
  if (config) {
    const silentLogger = createLogger({ silent: true, logs: false });
    const client = new GBrainClient(config, silentLogger);
    const graph = await client.loadGraph();
    if (client.lastSource !== "demo") {
      // loadGraph already saved to profile.json internally — we're done
      console.log(`${chalk.green("✓")} Profile loaded from GBrain ${chalk.dim(`(source: ${client.lastSource})`)}`);
      return;
    }
  }

  console.log("");
  console.log(chalk.bold("Profile setup") + chalk.dim(" — describe yourself in a sentence or two"));
  console.log(chalk.dim("  Include: what you're building, what skills you offer, what you're looking for."));
  console.log(chalk.dim("  Example: \"I'm building a DeFi settlement protocol. I offer Solidity/web3 expertise"));
  console.log(chalk.dim("  and fintech compliance knowledge. Looking for AI agent infrastructure and ML.\""));
  console.log("");

  const rl = readline.createInterface({ input, output });
  try {
    const description = (await rl.question("  You: ")).trim();
    if (!description) {
      console.log(chalk.yellow("  No description entered — using demo profile."));
      return;
    }

    let profile: Record<string, unknown>;

    const hasLlm = Boolean(config?.llmApiKey);
    if (hasLlm) {
      process.stdout.write(chalk.dim("  Extracting profile with LLM…"));
      profile = await extractProfileWithLLM(description, config!.llmApiKey!) ?? fallbackProfile(description);
      process.stdout.write(chalk.dim(" done\n"));
    } else {
      profile = fallbackProfile(description);
    }

    await writeJson(profileFile, { ...profile, _source: "wizard" });
    console.log(`${chalk.green("✓")} Profile saved`);
    if (Array.isArray(profile.skills) && profile.skills.length) {
      console.log(`  ${chalk.dim("Skills:")} ${(profile.skills as string[]).slice(0, 4).join(", ")}`);
    }
    if (Array.isArray(profile.needs) && profile.needs.length) {
      console.log(`  ${chalk.dim("Needs:")} ${(profile.needs as string[]).slice(0, 3).join(", ")}`);
    }

    if (config) {
      const silentLogger = createLogger({ silent: true, logs: false });
      const client = new GBrainClient(config, silentLogger);
      await client.saveProfileToGBrain(profile);
      console.log(`${chalk.green("✓")} Saved to GBrain ${chalk.dim("(gbrain get profile)")}`);
    }
    console.log("");
  } finally {
    rl.close();
  }
}

async function extractProfileWithLLM(
  description: string,
  apiKey: string,
): Promise<Record<string, unknown> | null> {
  const { LLMClient } = await import("./llm.js");
  const llm = new LLMClient(apiKey);
  const prompt = [
    "Extract a structured profile from this person's self-description.",
    "Return ONLY valid JSON with these exact keys:",
    "  summary (string — 1-2 rich sentences),",
    "  current_work (string — what they're building right now),",
    "  skills (string[] — concrete things they can offer, 4-8 items),",
    "  needs (string[] — what they're actively looking for, 3-6 items),",
    "  domain (string — primary industry/area),",
    "  interests (string[] — 3-5 topics they care about),",
    "  projects (string[] — 1-3 named projects),",
    "  cares_about (string[] — 2-4 values or outcomes).",
    "Be specific. Infer reasonable detail from context. No empty arrays.",
    "",
    `Self-description: "${description}"`,
  ].join("\n");

  try {
    const text = await llm.complete(prompt, { maxTokens: 700, temperature: 0.1 });
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function fallbackProfile(description: string): Record<string, unknown> {
  return {
    summary: description,
    current_work: description.slice(0, 120),
    skills: [],
    needs: [],
    domain: "",
    interests: [],
    projects: [],
    cares_about: [],
  };
}
