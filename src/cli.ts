#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { startAgent } from "./index.js";
import { startSimulation } from "./simulate.js";
import { startInteraction } from "./interaction.js";
import { createLogger } from "./logger.js";
import { reconfigureAgent } from "./setup.js";
import { readJson, statePath } from "./storage.js";
import { GBrainClient } from "./gbrain.js";
import { renderResults, renderFinalRanking } from "./display.js";
import { MatchResult, SandboxResult } from "./types.js";
import { unlink } from "node:fs/promises";
import chalk from "chalk";

void yargs(hideBin(process.argv))
  .scriptName("gbrain-agent")
  .command(
    "start",
    "Start the GBrain Network Agent",
    (builder) =>
      builder
        .option("silent", {
          type: "boolean",
          default: false,
          describe: "Suppress live activity stream and show only final results",
        })
        .option("logs", {
          type: "boolean",
          default: false,
          describe: "Show verbose mDNS, Primitive, and LLM diagnostics",
        })
        .option("once", {
          type: "boolean",
          default: false,
          describe: "Process existing peers once and exit (useful for smoke tests)",
        })
        .option("no-browser", {
          type: "boolean",
          default: false,
          describe: "Skip auto-opening the Mission Control browser tab",
        }),
    async (argv) => {
      const running = await startAgent({
        silent: Boolean(argv.silent),
        logs: Boolean(argv.logs),
        once: Boolean(argv.once),
        noBrowser: Boolean(argv["no-browser"]),
      });
      if (argv.once) {
        return;
      }

      const allMatches: MatchResult[] = [];
      const allSandboxes: SandboxResult[] = [];
      let interactionCleanup: (() => void) = () => undefined;

      function refreshInteraction(): void {
        interactionCleanup();
        console.log("");
        renderResults(allMatches, allSandboxes);
        interactionCleanup = startInteraction(allMatches, allSandboxes);
      }

      let rankingTimer: ReturnType<typeof setTimeout> | null = null;

      function scheduleRanking(): void {
        if (rankingTimer) clearTimeout(rankingTimer);
        // Print final ranking 8 seconds after the last match arrives (all peers probably done)
        rankingTimer = setTimeout(() => {
          if (allSandboxes.length > 1) {
            interactionCleanup();
            renderFinalRanking(allMatches, allSandboxes);
            interactionCleanup = startInteraction(allMatches, allSandboxes);
          }
        }, 8000);
      }

      // Show interaction when a live-discovered match completes
      running.onMatchReady((match, sandbox) => {
        allMatches.push(match);
        if (sandbox) allSandboxes.push(sandbox);
        refreshInteraction();
        scheduleRanking();
      });

      // Also process any peers already stored from a previous run
      const { matches, sandboxes } = await running.runExistingPeers();
      if (matches.length) {
        allMatches.push(...matches);
        allSandboxes.push(...sandboxes);
        refreshInteraction();
      }

      const shutdown = () => { interactionCleanup(); running.stop(); process.exit(0); };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    },
  )
  .command(
    "connect",
    "Send an encrypted handshake to a peer via Primitive email",
    (builder) =>
      builder
        .option("to", {
          type: "string",
          demandOption: true,
          describe: "Peer Primitive email address to send the handshake to",
        })
        .option("silent", {
          type: "boolean",
          default: false,
          describe: "Suppress live activity stream and show only final results",
        })
        .option("logs", {
          type: "boolean",
          default: false,
          describe: "Show verbose mDNS, Primitive, and LLM diagnostics",
        })
        .option("wait", {
          type: "boolean",
          default: true,
          describe: "Keep the agent running to receive the response via webhook",
        }),
    async (argv) => {
      const running = await startAgent({
        silent: Boolean(argv.silent),
        logs: Boolean(argv.logs),
      });
      try {
        await running.connectTo(String(argv.to));
      } catch (error) {
        console.error((error as Error).message);
        running.stop();
        process.exit(1);
      }

      if (!argv.wait) {
        running.stop();
        return;
      }

      process.once("SIGINT", () => {
        running.stop();
        process.exit(0);
      });
      process.once("SIGTERM", () => {
        running.stop();
        process.exit(0);
      });
    },
  )
  .command(
    "setup",
    "Reconfigure agent credentials (preserves peers, profile, and identity)",
    () => {},
    async () => {
      const logger = createLogger({ silent: false, logs: false });
      const config = await reconfigureAgent(logger);
      console.log(`\n${chalk.green("✓")} Config saved — run ${chalk.cyan("gbrain-agent start")} to launch`);
      console.log(
        chalk.dim(`  Webhook will listen on port ${config.webhookPort ?? 64320} — run npx localtunnel --port ${config.webhookPort ?? 64320}`),
      );
    },
  )
  .command(
    "profile <action>",
    "Manage your local GBrain profile",
    (builder) =>
      builder.positional("action", {
        choices: ["show", "refresh"] as const,
        describe: '"show" prints the current profile; "refresh" re-queries gbrain CLI and re-parses with Claude',
      }),
    async (argv) => {
      const action = argv.action as "show" | "refresh";

      if (action === "show") {
        const profile = await readJson<Record<string, unknown> | null>("profile.json", null);
        if (!profile) {
          console.log(chalk.yellow("No profile found. Run: gbrain-agent profile refresh"));
          return;
        }
        const { _source, summary, skills, needs, interests, projects, domain } = profile as Record<string, unknown>;
        console.log(chalk.bold("Profile") + chalk.dim(` (source: ${String(_source ?? "unknown")})`));
        console.log(`  Summary   : ${String(summary ?? "—").slice(0, 200)}`);
        console.log(`  Skills    : ${JSON.stringify(skills ?? [])}`);
        console.log(`  Needs     : ${JSON.stringify(needs ?? [])}`);
        console.log(`  Interests : ${JSON.stringify(interests ?? [])}`);
        console.log(`  Projects  : ${JSON.stringify(projects ?? [])}`);
        console.log(`  Domain    : ${String(domain ?? "—")}`);
        return;
      }

      // refresh — delete cached profile then re-query (loadGraph saves result automatically)
      try {
        await unlink(statePath("profile.json"));
        console.log(chalk.dim("Deleted cached profile — re-querying gbrain…"));
      } catch {
        // no existing file, fine
      }

      const stored = await readJson<import("./types.js").AgentConfig | null>("config.json", null);
      if (!stored) {
        console.log(chalk.yellow("No config found. Run: gbrain-agent setup"));
        return;
      }
      // Merge env overrides so LLM key is picked up even if not saved yet
      const config: import("./types.js").AgentConfig = {
        ...stored,
        llmApiKey: stored.llmApiKey ?? process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY,
        webhookPort: stored.webhookPort ?? (process.env.GBRAIN_WEBHOOK_PORT ? Number(process.env.GBRAIN_WEBHOOK_PORT) : undefined),
      };

      if (!config.llmApiKey) {
        console.log(
          chalk.yellow("⚠ No LLM key — gbrain output cannot be parsed into structured profile fields."),
        );
        console.log(chalk.dim("  Run: gbrain-agent setup  and enter your key at Step 3/5 (Claude sk-ant-... or OpenAI sk-...)."));
      }

      const logger = createLogger({ silent: false, logs: true }); // verbose so LLM errors surface
      const client = new GBrainClient(config, logger);
      const graph = await client.loadGraph();
      if (client.lastSource === "demo") {
        console.log(chalk.yellow("⚠ Fell back to demo profile — OpenAI/Claude call may have failed (see debug lines above)."));
      } else {
        console.log(`${chalk.green("✓")} Profile refreshed (source: ${client.lastSource})`);
        console.log(`  Summary: ${graph.summary.slice(0, 150)}`);
        console.log(`  Skills : ${graph.capabilities.offers.join(", ") || "—"}`);
        console.log(`  Needs  : ${graph.capabilities.needs.join(", ") || "—"}`);
      }
    },
  )
  .command(
    "simulate",
    "Spawn simulated GBrain agents on the local network",
    (builder) =>
      builder
        .option("count", {
          type: "number",
          default: 15,
          describe: "Number of simulated agents to advertise",
        })
        .option("silent", {
          type: "boolean",
          default: false,
          describe: "Suppress activity output",
        })
        .option("logs", {
          type: "boolean",
          default: false,
          describe: "Show verbose diagnostics",
        })
        .option("stagger", {
          type: "number",
          default: 0,
          describe: "Seconds between each simulated agent appearing (0 = all at once)",
        }),
    async (argv) => {
      const agents = await startSimulation(Number(argv.count), {
        silent: Boolean(argv.silent),
        logs: Boolean(argv.logs),
        staggerSeconds: Number(argv.stagger),
      });
      process.once("SIGINT", () => {
        for (const agent of agents) {
          agent.stop();
        }
        process.exit(0);
      });
    },
  )
  .demandCommand(1)
  .strict()
  .help()
  .parseAsync();
