import Anthropic from "@anthropic-ai/sdk";
import { CollaborationBrief, KnowledgeGraph, MatchResult, Peer, SandboxResult } from "./types.js";
import { AgentLogger } from "./logger.js";
import { readJson, writeJson } from "./storage.js";
import { PrimitiveTransport } from "./transport.js";

const sandboxesFile = "sandboxes.json";

export class SandboxOrchestrator {
  private readonly anthropic?: Anthropic;

  constructor(
    apiKey: string | undefined,
    private readonly transport: PrimitiveTransport,
    private readonly logger: AgentLogger,
  ) {
    if (apiKey && !apiKey.startsWith("demo_")) {
      this.anthropic = new Anthropic({ apiKey });
    }
  }

  async run(peer: Peer, match: MatchResult, myGraph: KnowledgeGraph, peerGraph: KnowledgeGraph): Promise<SandboxResult> {
    const cached = await readJson<Record<string, SandboxResult>>(sandboxesFile, {});
    if (cached[peer.id]) {
      return cached[peer.id];
    }

    this.logger.emitEvent("sandbox:started", `Sandbox started with ${peer.pseudonym}`, { peerId: peer.id });
    const prompts = [
      "Round 1: Exchange capability vectors (what I have, what I need).",
      "Round 2: Exchange project context and brainstorm collaboration ideas.",
      "Round 3: Draft a collaboration brief with what we'd build, each contribution, what each gets, and non-obvious connections.",
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
    if (!this.anthropic) {
      return [
        prompt,
        `Local agent offers: ${myGraph.capabilities.offers.join(", ")}.`,
        `Peer offers: ${peerGraph.capabilities.offers.join(", ")}.`,
        `Collaboration direction: ${match.collaboration}.`,
      ].join("\n");
    }

    const response = await this.anthropic.messages.create({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 700,
      temperature: 0.3,
      messages: [
        {
          role: "user",
          content: [
            "Write a concise agent-to-agent Primitive email sandbox message.",
            prompt,
            `Match: ${JSON.stringify(match)}`,
            `Local graph: ${JSON.stringify(myGraph)}`,
            `Peer graph: ${JSON.stringify(peerGraph)}`,
          ].join("\n"),
        },
      ],
    });
    return response.content.map((block) => ("text" in block ? block.text : "")).join("\n");
  }

  private async generateBrief(
    match: MatchResult,
    myGraph: KnowledgeGraph,
    peerGraph: KnowledgeGraph,
    roundResponses: string[],
  ): Promise<CollaborationBrief> {
    if (!this.anthropic) {
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

    const response = await this.anthropic.messages.create({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 900,
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: [
            "Return only JSON for a collaboration brief with keys title, whatWeWouldBuild, eachContributes array, eachGets array, nonObviousConnections array.",
            `Match: ${JSON.stringify(match)}`,
            `Local graph: ${JSON.stringify(myGraph)}`,
            `Peer graph: ${JSON.stringify(peerGraph)}`,
            `Rounds: ${JSON.stringify(roundResponses)}`,
          ].join("\n"),
        },
      ],
    });
    const text = response.content.map((block) => ("text" in block ? block.text : "")).join("");
    return JSON.parse(text.replace(/^```json\s*/i, "").replace(/```$/i, "")) as CollaborationBrief;
  }
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
