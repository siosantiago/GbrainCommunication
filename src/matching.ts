import Anthropic from "@anthropic-ai/sdk";
import { KnowledgeGraph, MatchResult, Peer, TrustTier } from "./types.js";
import { AgentLogger } from "./logger.js";
import { readJson, writeJson } from "./storage.js";

const matchesFile = "matches.json";

export class Matcher {
  private readonly anthropic?: Anthropic;

  constructor(
    apiKey: string | undefined,
    private readonly logger: AgentLogger,
  ) {
    if (apiKey && !apiKey.startsWith("demo_")) {
      this.anthropic = new Anthropic({ apiKey });
    }
  }

  async score(peer: Peer, myGraph: KnowledgeGraph, peerGraph: KnowledgeGraph, trustTier: TrustTier): Promise<MatchResult> {
    const cached = await readJson<Record<string, MatchResult>>(matchesFile, {});
    if (cached[peer.id]) {
      return cached[peer.id];
    }

    const result = this.anthropic
      ? await this.scoreWithClaude(peer, myGraph, peerGraph, trustTier)
      : this.scoreLocally(peer, myGraph, peerGraph, trustTier);

    cached[peer.id] = result;
    await writeJson(matchesFile, cached);
    this.logger.emitEvent("match:scored", `${peer.pseudonym} scored ${result.score}`, { peerId: peer.id, score: result.score });
    return result;
  }

  private async scoreWithClaude(
    peer: Peer,
    myGraph: KnowledgeGraph,
    peerGraph: KnowledgeGraph,
    trustTier: TrustTier,
  ): Promise<MatchResult> {
    const prompt = [
      "You are matching two hackathon attendees from their GBrain collaboration graphs.",
      "Return only valid JSON with keys: score (0-100), collaboration, theyBring array, youBring array, reasons array.",
      "Prioritize specific non-obvious collaboration potential and cite concrete graph facts.",
      "",
      `Person A (local): ${JSON.stringify(myGraph)}`,
      `Person B (${peer.pseudonym}): ${JSON.stringify(peerGraph)}`,
    ].join("\n");

    const response = await this.anthropic!.messages.create({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 900,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content
      .map((block) => ("text" in block ? block.text : ""))
      .join("")
      .trim();
    const parsed = JSON.parse(text.replace(/^```json\s*/i, "").replace(/```$/i, "")) as Partial<MatchResult>;
    return normalizeMatch(peer, parsed, trustTier);
  }

  private scoreLocally(peer: Peer, myGraph: KnowledgeGraph, peerGraph: KnowledgeGraph, trustTier: TrustTier): MatchResult {
    const myNeeds = lowerSet(myGraph.capabilities.needs);
    const myOffers = lowerSet(myGraph.capabilities.offers);
    const peerNeeds = lowerSet(peerGraph.capabilities.needs);
    const peerOffers = lowerSet(peerGraph.capabilities.offers);

    const peerSatisfiesMe = overlap(myNeeds, peerOffers);
    const iSatisfyPeer = overlap(peerNeeds, myOffers);
    const sharedInterests = overlap(lowerSet(myGraph.capabilities.interests), lowerSet(peerGraph.capabilities.interests));
    const score = Math.min(99, 55 + peerSatisfiesMe.length * 12 + iSatisfyPeer.length * 12 + sharedInterests.length * 5);

    return normalizeMatch(
      peer,
      {
        score,
        collaboration: inferCollaboration(myGraph, peerGraph),
        theyBring: peerGraph.capabilities.offers.slice(0, 3),
        youBring: myGraph.capabilities.offers.slice(0, 3),
        reasons: [
          ...peerSatisfiesMe.map((item) => `They offer ${item}, which matches one of your active needs`),
          ...iSatisfyPeer.map((item) => `You offer ${item}, which matches one of their active needs`),
          ...sharedInterests.map((item) => `You both care about ${item}`),
        ].slice(0, 5),
      },
      trustTier,
    );
  }
}

function normalizeMatch(peer: Peer, result: Partial<MatchResult>, trustTier: TrustTier): MatchResult {
  return {
    peerId: peer.id,
    pseudonym: peer.pseudonym,
    score: clampScore(result.score ?? 70),
    collaboration: result.collaboration ?? "Agent-sandboxed collaboration opportunity",
    theyBring: list(result.theyBring, ["Relevant capabilities from their GBrain"]),
    youBring: list(result.youBring, ["Relevant capabilities from your GBrain"]),
    reasons: list(result.reasons, ["Your GBrain graphs have complementary needs and capabilities"]),
    trustTier,
    createdAt: new Date().toISOString(),
  };
}

function inferCollaboration(myGraph: KnowledgeGraph, peerGraph: KnowledgeGraph): string {
  const project = myGraph.capabilities.projects[0] ?? "a fast hackathon prototype";
  const peerOffer = peerGraph.capabilities.offers[0] ?? "their missing capability";
  return `${project} using ${peerOffer}`;
}

function lowerSet(items: string[]): string[] {
  return items.map((item) => item.toLowerCase());
}

function overlap(a: string[], b: string[]): string[] {
  return a.filter((left) => b.some((right) => right.includes(left) || left.includes(right)));
}

function list(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.length ? value.map(String) : fallback;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
