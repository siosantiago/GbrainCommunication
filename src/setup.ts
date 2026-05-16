import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";
import { AgentConfig, KnowledgeGraph } from "./types.js";
import { readJson, writeJson } from "./storage.js";
import { GBrainClient } from "./gbrain.js";
import { importProfileFromLocalGbrain, ProfileSource } from "./gbrain-local.js";
import { AgentLogger } from "./logger.js";
import { renderWelcome } from "./display.js";

const configFile = "config.json";
const profileFile = "profile.json";

type StoredProfile = KnowledgeGraph & { _source?: ProfileSource };

export async function loadOrCreateProfile(config: AgentConfig): Promise<void> {
  if (config.gbrainApiKey && !config.gbrainApiKey.startsWith("demo_")) {
    return;
  }

  const existing = await readJson<StoredProfile | null>(profileFile, null);
  if (existing?.summary) {
    return;
  }

  const fromLocal = await importProfileFromLocalGbrain();
  if (fromLocal) {
    await writeJson(profileFile, { ...fromLocal, _source: "local_gbrain" } satisfies StoredProfile);
    return;
  }

  if (!process.stdin.isTTY) {
    return;
  }
}

export async function pullProfileFromLocalGbrain(): Promise<KnowledgeGraph | null> {
  const graph = await importProfileFromLocalGbrain();
  if (!graph) {
    return null;
  }
  await writeJson(profileFile, { ...graph, _source: "local_gbrain" } satisfies StoredProfile);
  return graph;
}

export async function getProfileSource(): Promise<ProfileSource> {
  const saved = await readJson<StoredProfile | null>(profileFile, null);
  if (saved?._source === "local_gbrain") {
    return "local_gbrain";
  }
  if (saved?.summary) {
    return "profile_json";
  }
  return "demo";
}

export async function loadOrSetupConfig(logger: AgentLogger): Promise<AgentConfig> {
  const existing = await readJson<AgentConfig | null>(configFile, null);
  const fromEnv = configFromEnv();

  if (existing?.primitiveApiKey && existing.primitiveFrom) {
    return { ...existing, ...emptyFields(fromEnv) };
  }

  if (!process.stdin.isTTY) {
    const demo: AgentConfig = {
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
    console.log(chalk.dim("You'll need a Primitive account (primitive.dev) and an Anthropic API key.\n"));

    // Step 1: Primitive API key
    console.log(chalk.bold.blue("Step 1/4:") + chalk.bold(" Primitive email"));
    console.log(chalk.dim("  Get your key at primitive.dev → Settings → API keys\n"));
    const primitiveApiKey =
      fromEnv.primitiveApiKey ||
      (await secretPrompt(rl, chalk.dim("  API key (prim_...): ")));

    const primitiveFrom =
      fromEnv.primitiveFrom ||
      (await rl.question(
        chalk.dim("  Sender address (e.g. agent@your-org.primitive.email): "),
      ));

    console.log(`  ${chalk.green("✓")} Primitive configured\n`);

    // Step 2: Anthropic key (optional but strongly recommended)
    console.log(chalk.bold.blue("Step 2/4:") + chalk.bold(" Claude API (for smart matching)"));
    console.log(chalk.dim("  Get your key at console.anthropic.com → API Keys\n"));
    const anthropicApiKey =
      fromEnv.anthropicApiKey ||
      (await secretPrompt(rl, chalk.dim("  Anthropic key (sk-ant-... or press Enter to skip): ")));

    if (anthropicApiKey) {
      console.log(`  ${chalk.green("✓")} Claude matching enabled\n`);
    } else {
      console.log(`  ${chalk.yellow("!")} Skipped — will use basic keyword matching\n`);
    }

    // Step 3: GBrain API key (optional — most users won't have this yet)
    const gbrainApiKey = fromEnv.gbrainApiKey || "";

    const config: AgentConfig = {
      gbrainApiKey,
      primitiveApiKey: primitiveApiKey.trim(),
      primitiveFrom: primitiveFrom.trim(),
      primitiveWebhookSecret: fromEnv.primitiveWebhookSecret,
      anthropicApiKey: anthropicApiKey.trim() || undefined,
      gbrainBaseUrl: fromEnv.gbrainBaseUrl,
      webhookPort: fromEnv.webhookPort,
    };

    await writeJson(configFile, config);

    // Step 4: Profile wizard (replaces GBrain API for most users)
    const existingProfile = await readJson<KnowledgeGraph | null>(profileFile, null);
    if (!existingProfile) {
      await runProfileWizard(rl);
    } else {
      console.log(`${chalk.green("✓")} Profile already set up`);
      const update = await rl.question(chalk.dim("  Update your profile? (y/N): "));
      if (update.trim().toLowerCase() === "y") {
        await runProfileWizard(rl);
      }
    }

    const validGbrain = await new GBrainClient(config, logger).validate();
    if (!gbrainApiKey || gbrainApiKey.startsWith("demo_")) {
      console.log(`\n${chalk.green("✓")} Profile loaded from wizard`);
    } else {
      console.log(`\n${chalk.green("✓")} GBrain key ${validGbrain ? "validated" : "stored"}`);
    }

    return config;
  } finally {
    rl.close();
  }
}

export async function runProfileWizard(rl?: readline.Interface): Promise<KnowledgeGraph> {
  const shouldClose = !rl;
  if (!rl) {
    rl = readline.createInterface({ input, output });
  }

  try {
    console.log("\n" + chalk.bold.blue("Step 3/4:") + chalk.bold(" Your profile"));
    console.log(chalk.dim("  Your agent uses this to find collaborations."));
    console.log(chalk.dim("  Be specific — better profile = better matches.\n"));

    const currentWork = await rl.question(
      chalk.dim("  What are you building or working on right now?\n  → "),
    );

    const offersRaw = await rl.question(
      chalk.dim("\n  What can you offer? (skills, resources, access, connections)\n  comma separated → "),
    );

    const needsRaw = await rl.question(
      chalk.dim("\n  What are you actively looking for or stuck on?\n  comma separated → "),
    );

    const domain = await rl.question(
      chalk.dim('\n  Your domain (e.g. "health tech", "developer tools", "climate")\n  → '),
    );

    console.log("\n" + chalk.bold.blue("Step 4/4:") + chalk.bold(" Identity (for Tier 3 reveal only)"));
    console.log(chalk.dim("  Only shown when both people mutually consent to full reveal.\n"));

    const name = await rl.question(chalk.dim("  Your name: "));
    const role = await rl.question(chalk.dim("  Your role (e.g. 'Founder', 'ML engineer', 'Designer'): "));

    const offers = splitList(offersRaw);
    const needs = splitList(needsRaw);

    const summary = [
      currentWork.trim() ? `Building: ${currentWork.trim()}.` : "",
      offers.length ? `Offers: ${offers.join(", ")}.` : "",
      needs.length ? `Needs: ${needs.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const profile: KnowledgeGraph = {
      summary,
      capabilities: {
        offers,
        needs,
        interests: [],
        projects: currentWork.trim() ? [currentWork.trim()] : [],
      },
      people: [],
      companies: [],
      problems: needs,
      searches: needs,
      domainReveal: {
        role: role.trim() || undefined,
        domain: domain.trim() || undefined,
        experience: undefined,
        currentWork: currentWork.trim() || undefined,
        lookingFor: needs.join(", ") || undefined,
      },
      fullReveal: {
        name: name.trim() || undefined,
        company: undefined,
        role: role.trim() || undefined,
        contact: undefined,
      },
    };

    const stored: StoredProfile = { ...profile, _source: "profile_json" };
    await writeJson(profileFile, stored);
    console.log(`\n  ${chalk.green("✓")} Profile saved to state/profile.json\n`);
    return profile;
  } finally {
    if (shouldClose) rl.close();
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

function splitList(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
