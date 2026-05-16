import "dotenv/config";
import { createLogger } from "./logger.js";
import { getProfileSource, loadOrCreateProfile, loadOrSetupConfig } from "./setup.js";
import { KnowledgeGraph } from "./types.js";
import { loadOrCreateIdentity } from "./identity.js";
import { loadOrCreateKeypair } from "./crypto.js";
import { GBrainClient } from "./gbrain.js";
import { DiscoveryService } from "./discovery.js";
import { PrimitiveTransport } from "./transport.js";
import { PrimitiveWebhookServer } from "./webhook.js";
import { Matcher } from "./matching.js";
import { SandboxOrchestrator } from "./sandbox.js";
import { Orchestrator } from "./orchestrator.js";
import { renderSetupComplete } from "./display.js";
import { AgentOptions } from "./types.js";

export interface RunningAgent {
  stop: () => void;
  runExistingPeers: Orchestrator["runExistingPeers"];
}

export async function startAgent(options: AgentOptions & { once?: boolean }): Promise<RunningAgent> {
  const logger = createLogger(options);
  const config = await loadOrSetupConfig(logger);
  await loadOrCreateProfile(config);
  const identity = await loadOrCreateIdentity();
  const crypto = await loadOrCreateKeypair();
  const gbrain = new GBrainClient(config, logger);
  const graph = await gbrain.loadGraph();
  const profileSource = await getProfileSource();
  const webhook = new PrimitiveWebhookServer(config, logger);
  const port = await webhook.start();
  const transport = new PrimitiveTransport(config, logger);
  const matcher = new Matcher(config.anthropicApiKey, logger);
  const sandbox = new SandboxOrchestrator(config.anthropicApiKey, transport, logger);
  const discovery = new DiscoveryService({
    identity,
    primitiveEmail: config.primitiveFrom,
    publicKey: crypto.publicKey,
    port,
    logger,
  });
  const orchestrator = new Orchestrator({
    identity,
    crypto,
    config,
    graph,
    discovery,
    transport,
    matcher,
    sandbox,
    logger,
    silent: options.silent,
  });

  webhook.on("message", (message) => {
    void orchestrator.handleInbound(message).catch((error) => logger.error(`Inbound message failed: ${(error as Error).message}`));
  });
  orchestrator.start();
  await discovery.start();

  renderSetupComplete(identity, profileStatsLabel(graph, profileSource), config.primitiveFrom);

  const running: RunningAgent = {
    stop: () => {
      discovery.stop();
      webhook.stop();
    },
    runExistingPeers: () => orchestrator.runExistingPeers(),
  };

  if (options.once) {
    await running.runExistingPeers();
    running.stop();
  }

  return running;
}

function profileStatsLabel(graph: KnowledgeGraph, source: Awaited<ReturnType<typeof getProfileSource>>): string {
  const offers = graph.capabilities.offers.length;
  const needs = graph.capabilities.needs.length;
  const projects = graph.capabilities.projects.length;
  const counts =
    offers === 0 && needs === 0
      ? ""
      : `${offers} skill${offers !== 1 ? "s" : ""} · ${needs} need${needs !== 1 ? "s" : ""} · ${projects} project${projects !== 1 ? "s" : ""}`;

  switch (source) {
    case "local_gbrain":
      return counts ? `local gbrain · ${counts}` : "local gbrain · synced";
    case "profile_json":
      return counts ? `custom profile · ${counts}` : "custom profile · state/profile.json";
    default:
      return "demo profile · no GBrain API key";
  }
}
