import { decodeEncryptedBody, decryptJson, encodeEncryptedBody, encryptJson } from "./crypto.js";
import { demoGraph } from "./gbrain.js";
import { getTrust } from "./trust.js";
import { DiscoveryService } from "./discovery.js";
import { Matcher } from "./matching.js";
import { SandboxOrchestrator } from "./sandbox.js";
import { PrimitiveTransport } from "./transport.js";
import { AgentLogger } from "./logger.js";
import {
  AgentConfig,
  CryptoIdentity,
  Identity,
  KnowledgeGraph,
  MatchResult,
  Peer,
  PrimitiveMessage,
  SandboxResult,
  TierOnePayload,
} from "./types.js";
import { readJson, writeJson } from "./storage.js";
import { renderProgress, renderResults } from "./display.js";

const profileFile = "peer_profiles.json";

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
    const encrypted = decodeEncryptedBody(message.bodyText);
    if (!encrypted) {
      return;
    }

    const payload = decryptJson<TierOnePayload>(encrypted, this.options.crypto.secretKey);
    const profiles = await readJson<Record<string, TierOnePayload>>(profileFile, {});
    profiles[payload.fromPseudonym] = payload;
    await writeJson(profileFile, profiles);
    this.options.logger.debug(`Stored inbound Tier 1 profile from ${payload.fromPseudonym}`);
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

    await this.sendTierOne(peer);
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
