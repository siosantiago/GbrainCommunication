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
import { MissionControlServer } from "./web-server.js";
import { AgentOptions, MatchResult, SandboxResult } from "./types.js";

export interface RunningAgent {
  stop: () => void;
  runExistingPeers: Orchestrator["runExistingPeers"];
  connectTo: Orchestrator["connectTo"];
  nudgeKnownPeers: Orchestrator["nudgeKnownPeers"];
  onMatchReady: (cb: (match: MatchResult, sandbox?: SandboxResult) => void) => void;
}

export async function startAgent(options: AgentOptions & { once?: boolean }): Promise<RunningAgent> {
  const logger = createLogger(options);
  const config = await loadOrSetupConfig(logger);
  await loadOrCreateProfile(config);
  const identity = await loadOrCreateIdentity();
  const crypto = await loadOrCreateKeypair();
  const gbrain = new GBrainClient(config, logger);
  const graph = await gbrain.loadGraph();
  const webhook = new PrimitiveWebhookServer(config, logger);
  const port = await webhook.start();
  const dashPort = (config.webhookPort ?? 64320) + 100;
  const missionControl = new MissionControlServer(logger, dashPort, identity);
  await missionControl.start({ openBrowser: !options.noBrowser }).catch(() => { /* dashboard optional */ });
  const transport = new PrimitiveTransport(config, logger);
  const matcher = new Matcher(config.llmApiKey, logger);
  const sandbox = new SandboxOrchestrator(config.llmApiKey, transport, logger);
  const discovery = new DiscoveryService({
    identity,
    primitiveEmail: config.primitiveFrom,
    publicKey: crypto.publicKey,
    port,
    logger,
  });

  const matchCallbacks: Array<(match: MatchResult, sandbox?: SandboxResult) => void> = [];

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
    onMatchReady: (match, sb) => { for (const cb of matchCallbacks) cb(match, sb); },
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
      missionControl.stop();
    },
    runExistingPeers: () => orchestrator.runExistingPeers(),
    connectTo: (email) => orchestrator.connectTo(email),
    nudgeKnownPeers: () => orchestrator.nudgeKnownPeers(),
    onMatchReady: (cb) => { matchCallbacks.push(cb); },
  };

  if (options.once) {
    await running.runExistingPeers();
    running.stop();
  }

  return running;
}
