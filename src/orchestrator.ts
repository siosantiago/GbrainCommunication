import chalk from "chalk";
import {
  decodeEncryptedBody,
  decodeHandshake,
  decryptJson,
  encodeEncryptedBody,
  encodeHandshake,
  encryptJson,
} from "./crypto.js";
import { demoGraph } from "./gbrain.js";
import { getTrust } from "./trust.js";
import { DiscoveryService, peerId as derivePeerId } from "./discovery.js";
import { Matcher } from "./matching.js";
import { SandboxOrchestrator } from "./sandbox.js";
import { PrimitiveTransport } from "./transport.js";
import { AgentLogger } from "./logger.js";
import {
  AgentConfig,
  CryptoIdentity,
  HandshakePayload,
  Identity,
  KnowledgeGraph,
  MatchResult,
  Peer,
  PrimitiveMessage,
  SandboxResult,
  TierOnePayload,
} from "./types.js";
import { readJson, writeJson } from "./storage.js";
import { colorPseudonym, renderProgress, renderResults } from "./display.js";

const profileFile = "peer_profiles.json";
const peersFile = "peers.json";

export interface OrchestratorOptions {
  identity: Identity;
  crypto: CryptoIdentity;
  config: AgentConfig;
  graph: KnowledgeGraph;
  discovery: DiscoveryService;
  transport: PrimitiveTransport;
  matcher: Matcher;
  sandbox: SandboxOrchestrator;
  logger: AgentLogger;
  silent: boolean;
}

export class Orchestrator {
  private readonly activePeers = new Set<string>();
  private completedSandboxes = 0;
  private totalSandboxes = 0;

  constructor(private readonly options: OrchestratorOptions) {}

  start(): void {
    this.options.discovery.on("peer", (peer: Peer) => {
      void this.handlePeer(peer).catch((error) => {
        this.options.logger.error(`Peer flow failed for ${peer.pseudonym}: ${(error as Error).message}`);
      });
    });
  }

  async handleInbound(message: PrimitiveMessage): Promise<void> {
    const handshake = decodeHandshake(message.bodyText);
    if (handshake) {
      await this.handleHandshake(handshake, message);
      return;
    }

    const encrypted = decodeEncryptedBody(message.bodyText);
    if (!encrypted) {
      return;
    }

    const payload = decryptJson<TierOnePayload>(encrypted, this.options.crypto.secretKey);
    const profiles = await readJson<Record<string, TierOnePayload>>(profileFile, {});
    profiles[payload.fromPseudonym] = payload;
    await writeJson(profileFile, profiles);
    this.options.logger.debug(`Stored inbound Tier 1 profile from ${payload.fromPseudonym}`);

    const peer = await this.upsertPeer({
      pseudonym: payload.fromPseudonym,
      primitiveEmail: payload.fromEmail,
      publicKey: payload.publicKey,
      source: "manual",
    });
    void this.handlePeer(peer).catch((error) => {
      this.options.logger.error(`Inbound peer flow failed for ${peer.pseudonym}: ${(error as Error).message}`);
    });
  }

  async connectTo(email: string): Promise<void> {
    const handshake: HandshakePayload = {
      version: 1,
      type: "handshake",
      fromPseudonym: this.options.identity.pseudonym,
      fromEmail: this.options.config.primitiveFrom,
      publicKey: this.options.crypto.publicKey,
      sentAt: new Date().toISOString(),
    };

    this.options.logger.info(`Sending handshake to ${email}`);
    await this.options.transport.sendAgentMessage(email, {
      from: this.options.config.primitiveFrom,
      to: email,
      subject: `[GBrain ${this.options.identity.pseudonym}] handshake`,
      bodyText: encodeHandshake(handshake),
    });
    this.options.logger.emitEvent(
      "profile:sent",
      `${this.options.identity.pseudonym} → ${email} handshake (awaiting webhook response)`,
    );
  }

  async nudgeKnownPeers(): Promise<void> {
    const peers = await readJson<Record<string, Peer>>(peersFile, {});
    const records = Object.values(peers);
    if (!records.length) {
      return;
    }
    for (const peer of records) {
      const seen = relativeTime(peer.lastSeenAt);
      console.log(
        `  ${chalkPin()} Known peer ${colorPseudonym(peer.pseudonym)} ${dim(`(last seen ${seen}, source: ${peer.source})`)}`,
      );
    }
  }

  private async handleHandshake(handshake: HandshakePayload, message: PrimitiveMessage): Promise<void> {
    if (handshake.publicKey === this.options.crypto.publicKey) {
      return;
    }

    const peer = await this.upsertPeer({
      pseudonym: handshake.fromPseudonym,
      primitiveEmail: handshake.fromEmail || message.from,
      publicKey: handshake.publicKey,
      source: "manual",
    });
    this.options.logger.emitEvent(
      "peer:discovered",
      `Handshake received from ${peer.pseudonym} via Primitive`,
      { peerId: peer.id },
    );
    await this.handlePeer(peer);
  }

  private async upsertPeer(input: {
    pseudonym: string;
    primitiveEmail: string;
    publicKey: string;
    source: Peer["source"];
  }): Promise<Peer> {
    const id = derivePeerId(input.publicKey, input.primitiveEmail);
    const peers = await readJson<Record<string, Peer>>(peersFile, {});
    const existing = peers[id];
    const now = new Date().toISOString();
    const peer: Peer = {
      id,
      pseudonym: input.pseudonym,
      primitiveEmail: input.primitiveEmail,
      publicKey: input.publicKey,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
      source: existing?.source ?? input.source,
    };
    peers[id] = peer;
    await writeJson(peersFile, peers);
    return peer;
  }

  async runExistingPeers(): Promise<{ matches: MatchResult[]; sandboxes: SandboxResult[] }> {
    const peers = await readJson<Record<string, Peer>>("peers.json", {});
    const results = await Promise.all(Object.values(peers).map((peer) => this.handlePeer(peer)));
    const matches = results.map((result) => result?.match).filter(Boolean) as MatchResult[];
    const sandboxes = results.map((result) => result?.sandbox).filter(Boolean) as SandboxResult[];
    if (matches.length) {
      renderResults(matches, sandboxes);
    }
    return { matches, sandboxes };
  }

  private async handlePeer(peer: Peer): Promise<{ match: MatchResult; sandbox?: SandboxResult } | null> {
    if (this.activePeers.has(peer.id)) {
      return null;
    }
    this.activePeers.add(peer.id);

    const profiles = await readJson<Record<string, TierOnePayload>>(profileFile, {});
    const alreadyKnown = Boolean(profiles[peer.pseudonym]);
    if (alreadyKnown) {
      this.options.logger.info(`Already have profile for ${peer.pseudonym} — skipping Tier 1, re-scoring`);
    } else {
      await this.sendTierOne(peer);
    }
    const peerGraph = await this.loadPeerGraph(peer);
    const trust = await getTrust(peer.id, peer.pseudonym);
    const match = await this.options.matcher.score(peer, this.options.graph, peerGraph, trust.tier);

    let sandbox: SandboxResult | undefined;
    if (match.score >= 70) {
      this.totalSandboxes += 1;
      sandbox = await this.options.sandbox.run(peer, match, this.options.graph, peerGraph);
      this.completedSandboxes += 1;
      this.options.logger.emitEvent(
        "match:ready",
        `${renderProgress(this.completedSandboxes, this.totalSandboxes)} — ${peer.pseudonym} ready`,
        { peerId: peer.id },
      );
    }

    this.activePeers.delete(peer.id);
    return { match, sandbox };
  }

  private async sendTierOne(peer: Peer): Promise<void> {
    const payload: TierOnePayload = {
      version: 1,
      type: "tier1_profile",
      fromPseudonym: this.options.identity.pseudonym,
      fromEmail: this.options.config.primitiveFrom,
      publicKey: this.options.crypto.publicKey,
      graph: {
        summary: this.options.graph.summary,
        capabilities: this.options.graph.capabilities,
      },
      sentAt: new Date().toISOString(),
    };

    const encrypted = encryptJson(payload, peer.publicKey, this.options.crypto.secretKey, this.options.crypto.publicKey);
    await this.options.transport.sendAgentMessage(peer.primitiveEmail, {
      from: this.options.config.primitiveFrom,
      to: peer.primitiveEmail,
      subject: `[GBrain ${this.options.identity.pseudonym}] encrypted Tier 1 intro`,
      bodyText: encodeEncryptedBody(encrypted),
    });
    this.options.logger.emitEvent("profile:sent", `${this.options.identity.pseudonym} → ${peer.pseudonym} encrypted Tier 1 profile`, {
      peerId: peer.id,
    });
  }

  private async loadPeerGraph(peer: Peer): Promise<KnowledgeGraph> {
    const profiles = await readJson<Record<string, TierOnePayload>>(profileFile, {});
    const inbound = profiles[peer.pseudonym];
    if (inbound) {
      return {
        ...demoGraph(),
        summary: inbound.graph.summary,
        capabilities: inbound.graph.capabilities,
      };
    }
    return syntheticPeerGraph(peer);
  }
}

function chalkPin(): string {
  return chalk.yellow("📌");
}

function dim(text: string): string {
  return chalk.dim(text);
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "recently";
  }
  const diff = Date.now() - then;
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function syntheticPeerGraph(peer: Peer): KnowledgeGraph {
  const seed = Number.parseInt(peer.pseudonym.replace("#", "").slice(0, 2), 16) || 1;
  const profiles = [
    {
      offers: ["medical dataset access", "HIPAA compliance expertise", "health-tech GTM"],
      needs: ["speech ML infrastructure", "React Native mobile help"],
      collaboration: "HIPAA-compliant voice assistant for patient intake",
    },
    {
      offers: ["unused AWS credits", "YC partner intro", "infra operations"],
      needs: ["GPU workloads", "ML advisor", "data science expertise"],
      collaboration: "Shared infra cost-split and YC intro",
    },
    {
      offers: ["screen reader expertise", "W3C accessibility working group context"],
      needs: ["voice UI models", "mobile assistive app builder"],
      collaboration: "Open-source accessibility toolkit",
    },
  ];
  const selected = profiles[seed % profiles.length];
  return {
    summary: `${peer.pseudonym} offers ${selected.offers.join(", ")} and needs ${selected.needs.join(", ")}.`,
    capabilities: {
      offers: selected.offers,
      needs: selected.needs,
      interests: ["multimodal agents", "accessibility", "YC hackathons"],
      projects: [selected.collaboration],
    },
    people: ["NeurIPS 2024 multimodal workshop attendees"],
    companies: ["YC startups"],
    problems: selected.needs,
    searches: selected.needs,
    domainReveal: {
      role: "Builder at a startup",
      domain: selected.collaboration,
      experience: "5 years relevant operating experience",
      currentWork: selected.collaboration,
      lookingFor: selected.needs.join(", "),
    },
    fullReveal: {},
  };
}
