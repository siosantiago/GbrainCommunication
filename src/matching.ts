import { KnowledgeGraph, MatchResult, Peer, TrustTier } from "./types.js";
import { AgentLogger } from "./logger.js";
import { readJson, writeJson } from "./storage.js";
import { LLMClient } from "./llm.js";

const matchesFile = "matches.json";

export class Matcher {
  private readonly llm: LLMClient;

  constructor(
    apiKey: string | undefined,
    private readonly logger: AgentLogger,
  ) {
    this.llm = new LLMClient(apiKey);
  }

  async score(peer: Peer, myGraph: KnowledgeGraph, peerGraph: KnowledgeGraph, trustTier: TrustTier): Promise<MatchResult> {
    const cached = await readJson<Record<string, MatchResult>>(matchesFile, {});
    if (cached[peer.id]) {
      return cached[peer.id];
    }

    const result = this.llm.available
      ? await this.scoreWithLLM(peer, myGraph, peerGraph, trustTier)
      : this.scoreLocally(peer, myGraph, peerGraph, trustTier);

    cached[peer.id] = result;
    await writeJson(matchesFile, cached);
    this.logger.emitEvent("match:scored", `${peer.pseudonym} scored ${result.score}`, { peerId: peer.id, score: result.score });
    return result;
  }

  private async scoreWithLLM(
    peer: Peer,
    myGraph: KnowledgeGraph,
    peerGraph: KnowledgeGraph,
    trustTier: TrustTier,
  ): Promise<MatchResult> {
    // At Tier 1 pass only capabilities — never expose real names in the prompt
    const myAnon = {
      summary: myGraph.summary.replace(/^[A-Z][a-z]+ [A-Z][a-z]+\s*[—–-]\s*/, "Person A — "),
      capabilities: myGraph.capabilities,
      problems: myGraph.problems,
      searches: myGraph.searches,
    };
    const peerAnon = {
      summary: peerGraph.summary,
      capabilities: peerGraph.capabilities,
    };
    const prompt = [
      "You are matching two hackathon attendees from their GBrain collaboration graphs.",
      "Return only valid JSON with keys: score (0-100), collaboration (string), theyBring (string[]), youBring (string[]), reasons (string[]).",
      "Prioritize specific non-obvious collaboration potential. Do NOT use real names — use 'Person A' and 'Person B'.",
      "",
      `Person A (local): ${JSON.stringify(myAnon)}`,
      `Person B (${peer.pseudonym}): ${JSON.stringify(peerAnon)}`,
    ].join("\n");

    const text = await this.llm.complete(prompt, { maxTokens: 900, temperature: 0.2 });
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

    // Base 30 so a zero-overlap match honestly shows 30, not a misleading 55
    const score = Math.min(99, 30 + peerSatisfiesMe.length * 15 + iSatisfyPeer.length * 15 + sharedInterests.length * 8);

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
          ...(peerSatisfiesMe.length === 0 && iSatisfyPeer.length === 0
            ? ["Profiles don't share obvious skill overlap — review their summary manually"]
            : []),
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
  const myProject = myGraph.capabilities.projects[0];
  const peerProject = peerGraph.capabilities.projects[0];
  const peerOffer = peerGraph.capabilities.offers[0];
  const myNeed = myGraph.capabilities.needs[0];

  if (myProject && peerOffer) return `${myProject} + ${peerOffer}`;
  if (peerProject && myProject) return `${myProject} × ${peerProject}`;
  if (myNeed && peerOffer) return `${peerOffer} to address: ${myNeed}`;
  return "Explore collaboration potential in sandbox";
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
