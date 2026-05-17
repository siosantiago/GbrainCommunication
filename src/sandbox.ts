import { CollaborationBrief, KnowledgeGraph, MatchResult, Peer, SandboxResult } from "./types.js";
import { AgentLogger } from "./logger.js";
import { readJson, writeJson } from "./storage.js";
import { PrimitiveTransport } from "./transport.js";
import { LLMClient } from "./llm.js";

// Strip real identity fields before passing to LLM — keeps Tier 1 anonymity through sandbox rounds
function anonGraph(graph: KnowledgeGraph, label: "Person A" | "Person B"): Partial<KnowledgeGraph> {
  return {
    summary: graph.summary.replace(/^[A-Z][a-z]+ [A-Z][a-z]+\s*[—–-]\s*/, `${label} — `),
    capabilities: graph.capabilities,
    problems: graph.problems,
    searches: graph.searches,
    caresAbout: graph.caresAbout,
    domainReveal: { role: graph.domainReveal.role, domain: graph.domainReveal.domain },
  };
}

const sandboxesFile = "sandboxes.json";

export class SandboxOrchestrator {
  private readonly llm: LLMClient;

  constructor(
    apiKey: string | undefined,
    private readonly transport: PrimitiveTransport,
    private readonly logger: AgentLogger,
  ) {
    this.llm = new LLMClient(apiKey);
  }

  async run(peer: Peer, match: MatchResult, myGraph: KnowledgeGraph, peerGraph: KnowledgeGraph): Promise<SandboxResult> {
    const cached = await readJson<Record<string, SandboxResult>>(sandboxesFile, {});
    if (cached[peer.id]) {
      return cached[peer.id];
    }

    this.logger.emitEvent("sandbox:started", `Sandbox started with ${peer.pseudonym}`, { peerId: peer.id });
    const prompts = [
      "Round 1: Introduce yourself as an AI agent. Share your top 3 capabilities and your most pressing need. Ask a specific question about what they're building.",
      "Round 2: Respond to Round 1. Share more context on your current project — what's working, what's stuck. Identify one concrete way you could help each other in the next 48 hours.",
      "Round 3: Propose a specific collaboration — one thing you'd build together at the hackathon, how each person contributes, and what makes this non-obvious from the outside.",
    ] as const;

    const rounds = [];
    for (const [index, prompt] of prompts.entries()) {
      const round = (index + 1) as 1 | 2 | 3;
      this.logger.emitEvent("sandbox:round", `${peer.pseudonym} round ${round}/3 — ${roundLabel(round)}`, {
        peerId: peer.id,
        round,
      });
      const response = await this.generateRound(prompt, match, myGraph, peerGraph);
      rounds.push({
        round,
        prompt,
        response,
        completedAt: new Date().toISOString(),
      });
      await this.transport.send({
        to: peer.primitiveEmail,
        subject: `[GBrain ${peer.pseudonym}] sandbox round ${round}/3`,
        bodyText: response,
        wait: true,
      });
    }

    const brief = await this.generateBrief(match, myGraph, peerGraph, rounds.map((round) => round.response));
    const result: SandboxResult = {
      peerId: peer.id,
      pseudonym: peer.pseudonym,
      score: match.score,
      rounds,
      brief,
      completedAt: new Date().toISOString(),
    };
    cached[peer.id] = result;
    await writeJson(sandboxesFile, cached);
    this.logger.emitEvent("sandbox:complete", `Sandbox complete: ${peer.pseudonym} — score: ${match.score}`, {
      peerId: peer.id,
      score: match.score,
    });
    return result;
  }

  private async generateRound(
    prompt: string,
    match: MatchResult,
    myGraph: KnowledgeGraph,
    peerGraph: KnowledgeGraph,
  ): Promise<string> {
    if (!this.llm.available) {
      return [
        prompt,
        `Local agent offers: ${myGraph.capabilities.offers.join(", ")}.`,
        `Peer offers: ${peerGraph.capabilities.offers.join(", ")}.`,
        `Collaboration direction: ${match.collaboration}.`,
      ].join("\n");
    }

    return this.llm.complete(
      [
        "Write a concise agent-to-agent Primitive email sandbox message. Use 'Person A' for the local agent and 'Person B' for the peer — never use real names.",
        prompt,
        `Match: ${JSON.stringify(match)}`,
        `Local graph (Person A): ${JSON.stringify(anonGraph(myGraph, "Person A"))}`,
        `Peer graph (Person B): ${JSON.stringify(anonGraph(peerGraph, "Person B"))}`,
      ].join("\n"),
      { maxTokens: 700, temperature: 0.3 },
    );
  }

  private async generateBrief(
    match: MatchResult,
    myGraph: KnowledgeGraph,
    peerGraph: KnowledgeGraph,
    roundResponses: string[],
  ): Promise<CollaborationBrief> {
    if (!this.llm.available) {
      return {
        title: match.collaboration,
        whatWeWouldBuild: `A hackathon collaboration around ${match.collaboration}.`,
        eachContributes: [
          `You: ${myGraph.capabilities.offers.slice(0, 3).join(", ")}`,
          `Them: ${peerGraph.capabilities.offers.slice(0, 3).join(", ")}`,
        ],
        eachGets: [
          `You get help with ${myGraph.capabilities.needs.slice(0, 2).join(", ")}`,
          `They get help with ${peerGraph.capabilities.needs.slice(0, 2).join(", ")}`,
        ],
        nonObviousConnections: match.reasons.slice(0, 3),
      };
    }

    const text = await this.llm.complete(
      [
        "Return only valid JSON for a collaboration brief. Keys: title, whatWeWouldBuild, eachContributes (string[]), eachGets (string[]), nonObviousConnections (string[]).",
        "Use 'Person A' and 'Person B' — never use real names. Each array item must be a plain string.",
        `Match: ${JSON.stringify(match)}`,
        `Local graph (Person A): ${JSON.stringify(anonGraph(myGraph, "Person A"))}`,
        `Peer graph (Person B): ${JSON.stringify(anonGraph(peerGraph, "Person B"))}`,
        `Rounds: ${JSON.stringify(roundResponses)}`,
      ].join("\n"),
      { maxTokens: 900, temperature: 0.2 },
    );
    const raw = JSON.parse(text.replace(/^```json\s*/i, "").replace(/```$/i, "")) as Record<string, unknown>;
    return {
      title: String(raw.title ?? match.collaboration),
      whatWeWouldBuild: String(raw.whatWeWouldBuild ?? ""),
      eachContributes: toStrings(raw.eachContributes),
      eachGets: toStrings(raw.eachGets),
      nonObviousConnections: toStrings(raw.nonObviousConnections),
    };
  }
}

function toStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) =>
    typeof item === "string" ? item : typeof item === "object" && item !== null ? Object.values(item).join(" — ") : String(item),
  );
}

function roundLabel(round: 1 | 2 | 3): string {
  if (round === 1) {
    return "exchanging capability vectors";
  }
  if (round === 2) {
    return "exchanging project details";
  }
  return "drafting collaboration brief";
}
