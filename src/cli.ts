#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { startAgent } from "./index.js";
import { startSimulation } from "./simulate.js";
import { startInteraction } from "./interaction.js";
import chalk from "chalk";
import { pullProfileFromLocalGbrain, runProfileWizard } from "./setup.js";

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
        }),
    async (argv) => {
      const running = await startAgent({
        silent: Boolean(argv.silent),
        logs: Boolean(argv.logs),
        once: Boolean(argv.once),
      });
      if (argv.once) {
        return;
      }

      const { matches, sandboxes } = await running.runExistingPeers();
      const cleanup = startInteraction(matches, sandboxes);
      process.once("SIGINT", () => {
        cleanup();
        running.stop();
        process.exit(0);
      });
      process.once("SIGTERM", () => {
        cleanup();
        running.stop();
        process.exit(0);
      });
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
        }),
    async (argv) => {
      const agents = await startSimulation(Number(argv.count), {
        silent: Boolean(argv.silent),
        logs: Boolean(argv.logs),
      });
      process.once("SIGINT", () => {
        for (const agent of agents) {
          agent.stop();
        }
        process.exit(0);
      });
    },
  )
  .command("profile", "Manage your agent profile", (yargs) =>
    yargs
      .command(
        "pull",
        "Import profile from local gbrain CLI (~/.gbrain)",
        () => {},
        async () => {
          const graph = await pullProfileFromLocalGbrain();
          if (!graph) {
            console.error(chalk.red("Could not import from local gbrain."));
            console.error(chalk.dim("Install gbrain, run gbrain init, then retry."));
            process.exitCode = 1;
            return;
          }
          console.log(chalk.green("✓") + " Profile saved to state/profile.json from local gbrain");
          console.log(chalk.dim(`  ${graph.summary.slice(0, 120)}${graph.summary.length > 120 ? "…" : ""}`));
        },
      )
      .command(
        "wizard",
        "Run the interactive profile wizard",
        () => {},
        async () => {
          await runProfileWizard();
          console.log(chalk.green("✓") + " Profile updated. Run 'gbrain-agent start' to use it.");
        },
      )
      .demandCommand(1, "wizard"),
  )
  .demandCommand(1)
  .strict()
  .help()
  .parseAsync();
