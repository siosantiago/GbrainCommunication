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
  onMatchReady?: (match: MatchResult, sandbox?: SandboxResult) => void;
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

    const senderEmail = message.from || payload.fromEmail;
    const peer = await this.upsertPeer({
      pseudonym: payload.fromPseudonym,
      primitiveEmail: senderEmail,
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

    const senderEmail = message.from || handshake.fromEmail;
    if (!senderEmail) {
      this.options.logger.error("Handshake received without a usable sender email; dropping");
      return;
    }
    if (handshake.fromEmail && handshake.fromEmail !== senderEmail) {
      this.options.logger.debug(
        `Handshake fromEmail (${handshake.fromEmail}) differs from envelope sender (${senderEmail}); trusting envelope`,
      );
    }

    const peer = await this.upsertPeer({
      pseudonym: handshake.fromPseudonym,
      primitiveEmail: senderEmail,
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
    // 20% chance the agent decides to skip this peer entirely
    if (Math.random() < 0.2) {
      this.options.logger.info(`Passed on ${peer.pseudonym} — not the right fit right now`);
      return null;
    }

    this.activePeers.add(peer.id);
    const isSimulated = peer.source === "simulated" || peer.primitiveEmail.endsWith(".example");

    try {
      if (!isSimulated) {
        const profiles = await readJson<Record<string, TierOnePayload>>(profileFile, {});
        const alreadyKnown = Boolean(profiles[peer.pseudonym]);
        if (alreadyKnown) {
          this.options.logger.info(`Already have profile for ${peer.pseudonym} — skipping Tier 1, re-scoring`);
        } else {
          await this.sendTierOne(peer);
        }
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
        this.options.onMatchReady?.(match, sandbox);
        if (isSimulated && sandbox?.brief) {
          this.printRundown(peer, match, sandbox);
        }
      }

      return { match, sandbox };
    } finally {
      this.activePeers.delete(peer.id);
    }
  }

  private printRundown(peer: Peer, match: MatchResult, sandbox: SandboxResult): void {
    const { brief } = sandbox;
    console.log("");
    console.log(chalk.bold.cyan(`━━ Collaboration Rundown: ${peer.pseudonym} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
    console.log(`${chalk.yellow("Score:")} ${match.score}  ${chalk.dim("|")}  ${chalk.green(brief.title)}`);
    console.log(`${chalk.dim("What you'd build:")} ${brief.whatWeWouldBuild}`);
    if (brief.eachContributes.length) {
      console.log(chalk.dim("Contributions:"));
      for (const c of brief.eachContributes) console.log(`  ${chalk.blue("→")} ${c}`);
    }
    if (brief.nonObviousConnections.length) {
      console.log(chalk.dim("Why this works:"));
      for (const r of brief.nonObviousConnections.slice(0, 3)) console.log(`  ${chalk.dim("·")} ${r}`);
    }
    console.log(chalk.bold.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log("");
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
      name: "Health-tech founder",
      role: "Founder, clinical AI startup",
      domain: "voice-first patient intake and HIPAA-compliant clinical AI",
      summary: "Health-tech founder building voice-first patient intake with EHR integration. Has de-identified clinical datasets and deep HIPAA expertise. Needs AI agent infrastructure, speech ML, and React Native help to orchestrate multi-step clinical workflows autonomously.",
      offers: ["EHR data pipelines", "HIPAA compliance expertise", "medical NLP", "clinical trial data", "health-tech GTM"],
      needs: ["AI agent infrastructure", "P2P agent networking", "speech ML and Whisper fine-tuning", "React Native mobile UI", "GPU compute"],
      interests: ["clinical AI", "patient outcomes", "voice agents in healthcare", "multi-agent systems", "YC healthcare track"],
      projects: ["voice-first patient intake", "multi-agent clinical workflow orchestrator"],
    },
    {
      name: "Fintech / web3 engineer",
      role: "Senior engineer, DeFi protocol",
      domain: "cross-chain DeFi infrastructure and autonomous payment agents",
      summary: "Fintech engineer building cross-chain DeFi settlement infrastructure and autonomous payment agents on Ethereum and Solana. Has deep smart-contract and fintech compliance expertise. Looking for AI agent networking infrastructure to let payment agents discover and negotiate settlements with each other without a central clearinghouse.",
      offers: ["Solidity and smart contract development", "cross-chain bridge architecture", "DeFi protocol design", "fintech regulatory compliance", "web3 wallet integration", "Ethereum / Solana infrastructure"],
      needs: ["AI agent infrastructure and P2P networking", "LLM orchestration for autonomous trading", "identity and trust layer for agent-to-agent payments", "ML for on-chain fraud detection"],
      interests: ["autonomous payment agents", "DeFi", "cross-chain settlement", "agent-native fintech", "zero-knowledge proofs", "on-chain AI"],
      projects: ["cross-chain autonomous settlement protocol", "DeFi agent marketplace"],
    },
    {
      name: "Open-source ML researcher",
      role: "ML researcher, speech and multimodal",
      domain: "speech ML, Whisper fine-tuning, and open-source model tooling",
      summary: "ML researcher shipping open-source Whisper fine-tunes and multimodal voice pipelines. Has GPU cluster access and a library of speech datasets. Looking for real-world deployment partners — especially healthcare and fintech — to validate models in production.",
      offers: ["Whisper fine-tuning", "speech dataset access", "GPU cluster time", "multimodal model research", "open-source ML tooling", "React Native voice UI components"],
      needs: ["production deployment partners", "labeled domain-specific audio data (healthcare, finance)", "AI agent infrastructure for model serving", "GTM for ML tooling"],
      interests: ["open-source speech ML", "multimodal agents", "accessibility", "clinical voice AI", "YC hackathons"],
      projects: ["open-source Whisper fine-tune library", "voice-first patient intake ML pipeline"],
    },
    {
      name: "Developer tools founder",
      role: "Founder, developer tooling",
      domain: "AI-native developer tooling and code generation infrastructure",
      summary: "Founder building AI-native developer tooling — a code-aware agent layer that sits inside IDEs and autonomously handles PR reviews, test generation, and refactors. Has strong distribution among open-source maintainers and Series A traction. Needs agent networking to let dev agents collaborate across repos and teams without manual handoffs.",
      offers: ["developer community and distribution", "IDE plugin engineering", "AST-level code analysis", "LLM fine-tuning on code corpora", "Series A fundraising experience"],
      needs: ["AI agent networking infrastructure", "P2P agent discovery protocol", "encrypted agent identity layer", "enterprise security review support"],
      interests: ["agentic coding assistants", "developer experience", "open-source distribution", "agent-to-agent collaboration", "AI for DevOps"],
      projects: ["AI code review agent", "autonomous PR merging pipeline"],
    },
    {
      name: "Climate tech founder",
      role: "Founder, climate intelligence platform",
      domain: "climate risk modeling and autonomous ESG reporting agents",
      summary: "Climate tech founder building autonomous ESG reporting agents that pull from satellite, grid, and supply-chain APIs to generate regulator-ready reports. Has proprietary carbon-accounting datasets and deep relationships with institutional asset managers. Needs agent networking so ESG agents can share live sensor data across portfolio companies.",
      offers: ["carbon accounting datasets", "ESG regulatory expertise", "satellite data pipelines", "institutional LP network", "climate risk modeling"],
      needs: ["AI agent P2P networking", "real-time agent data sharing", "secure multi-party data exchange", "LLM summarization for regulatory docs"],
      interests: ["climate risk AI", "ESG automation", "agent data marketplaces", "institutional fintech", "Y Combinator climate cohort"],
      projects: ["autonomous ESG reporting agent", "cross-company carbon accounting network"],
    },
    {
      name: "Robotics engineer",
      role: "Robotics software engineer",
      domain: "autonomous robot fleet management and edge AI",
      summary: "Robotics engineer shipping edge AI inference for autonomous warehouse robot fleets. Has ROS2 expertise and proprietary sim-to-real training pipelines. Looking for agent networking infrastructure to let robots coordinate tasks across fleets without a central server — discovering each other on the local network and negotiating task handoffs autonomously.",
      offers: ["ROS2 and robotics middleware", "edge AI inference optimization", "sim-to-real training pipelines", "warehouse automation domain knowledge", "C++ and Python robotics stack"],
      needs: ["decentralized agent networking for robots", "mDNS and local-network agent discovery", "low-latency P2P agent communication", "AI task planning and orchestration"],
      interests: ["swarm robotics", "edge AI", "autonomous fleet coordination", "agent-native manufacturing", "hardware + software co-design"],
      projects: ["autonomous warehouse robot fleet", "edge AI inference runtime for ROS2"],
    },
  ];
  const selected = profiles[seed % profiles.length];
  return {
    summary: selected.summary,
    capabilities: {
      offers: selected.offers,
      needs: selected.needs,
      interests: selected.interests,
      projects: selected.projects,
    },
    people: ["NeurIPS 2024 multimodal workshop attendees", "ETHDenver builders"],
    companies: ["YC startups", "a16z crypto portfolio"],
    problems: selected.needs,
    searches: selected.needs,
    domainReveal: {
      role: selected.role,
      domain: selected.domain,
      experience: "6 years relevant experience",
      currentWork: selected.projects[0],
      lookingFor: selected.needs.slice(0, 2).join(", "),
    },
    fullReveal: {},
  };
}
