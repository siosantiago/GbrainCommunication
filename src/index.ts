import "dotenv/config";
import { createLogger } from "./logger.js";
import { loadOrCreateProfile, loadOrSetupConfig } from "./setup.js";
import { loadOrCreateIdentity } from "./identity.js";
import { loadOrCreateKeypair } from "./crypto.js";
import { GBrainClient } from "./gbrain.js";
import { DiscoveryService } from "./discovery.js";
import { PrimitiveTransport } from "./transport.js";
import { PrimitiveWebhookServer } from "./webhook.js";
import { Matcher } from "./matching.js";
import { SandboxOrchestrator } from "./sandbox.js";
import { Orchestrator } from "./orchestrator.js";
import { profileStatsLabel, renderSetupComplete, renderWebhookHint } from "./display.js";
import { AgentOptions } from "./types.js";
import { Pacer, pacingFromFlag } from "./pacing.js";

export interface RunningAgent {
  stop: () => void;
  runExistingPeers: Orchestrator["runExistingPeers"];
  connectTo: Orchestrator["connectTo"];
  nudgeKnownPeers: Orchestrator["nudgeKnownPeers"];
}

export interface StartAgentOptions extends AgentOptions {
  once?: boolean;
  pace?: string | number;
}

export async function startAgent(options: StartAgentOptions): Promise<RunningAgent> {
  const logger = createLogger(options);
  const config = await loadOrSetupConfig(logger);
  await loadOrCreateProfile();
  const identity = await loadOrCreateIdentity();
  const crypto = await loadOrCreateKeypair();
  const gbrain = new GBrainClient(config, logger);
  const graph = await gbrain.loadGraph();
  const webhook = new PrimitiveWebhookServer(config, logger);
  const port = await webhook.start();
  const transport = new PrimitiveTransport(config, logger);
  const pacer: Pacer = pacingFromFlag(options.pace);
  const matcher = new Matcher(config.anthropicApiKey, logger);
  const sandbox = new SandboxOrchestrator(config.anthropicApiKey, transport, logger, pacer);
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
    pacer,
  });

  webhook.on("message", (message) => {
    void orchestrator.handleInbound(message).catch((error) => logger.error(`Inbound message failed: ${(error as Error).message}`));
  });
  orchestrator.start();
  await discovery.start();

  renderSetupComplete(identity, profileStatsLabel(gbrain.lastSource), config.primitiveFrom);
  renderWebhookHint(config, port);
  try {
    await orchestrator.nudgeKnownPeers();
  } catch (error) {
    logger.error(`Known-peer nudge failed: ${(error as Error).message}`);
  }

  const running: RunningAgent = {
    stop: () => {
      discovery.stop();
      webhook.stop();
    },
    runExistingPeers: () => orchestrator.runExistingPeers(),
    connectTo: (email) => orchestrator.connectTo(email),
    nudgeKnownPeers: () => orchestrator.nudgeKnownPeers(),
  };

  if (options.once) {
    await running.runExistingPeers();
    running.stop();
  }

  return running;
}
