#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { startAgent } from "./index.js";
import { startSimulation } from "./simulate.js";
import { startInteraction } from "./interaction.js";

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
      const cleanup = startInteraction(matches, sandboxes, running.requestTrustUpgrade);
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
  .demandCommand(1)
  .strict()
  .help()
  .parseAsync();
