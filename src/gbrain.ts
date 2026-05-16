import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { AgentConfig, CapabilityVector, KnowledgeGraph } from "./types.js";
import { AgentLogger } from "./logger.js";
import { readJson, writeJson } from "./storage.js";

const profileFile = "profile.json";
const execFileAsync = promisify(execFile);

export type ProfileSource = "cached" | "local-brain" | "wizard" | "remote-api" | "demo";

export class GBrainClient {
  public lastSource: ProfileSource = "demo";

  constructor(
    private readonly config: AgentConfig,
    private readonly logger: AgentLogger,
  ) {}

  async validate(): Promise<boolean> {
    if (!this.config.gbrainApiKey || this.config.gbrainApiKey.startsWith("demo_")) {
      return true;
    }

    try {
      const response = await fetch(`${this.baseUrl()}/profile`, {
        headers: { Authorization: `Bearer ${this.config.gbrainApiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async loadGraph(): Promise<KnowledgeGraph> {
    const cached = await readJson<Record<string, unknown> | null>(profileFile, null);
    if (cached && hasMeaningfulProfileContent(cached)) {
      this.lastSource = inferCachedSource(cached);
      this.logger.info(`GBrain profile loaded ${labelFor(this.lastSource)}`);
      return extractGraph(cached);
    }

    const brainProfile = await this.queryLocalGBrain();
    if (brainProfile) {
      await writeJson(profileFile, { ...brainProfile, _source: "local-brain" });
      this.lastSource = "local-brain";
      this.logger.info("GBrain profile loaded (from local brain)");
      return extractGraph(brainProfile);
    }

    if (this.config.gbrainApiKey && !this.config.gbrainApiKey.startsWith("demo_")) {
      try {
        const response = await fetch(`${this.baseUrl()}/profile`, {
          headers: {
            Authorization: `Bearer ${this.config.gbrainApiKey}`,
            Accept: "application/json",
          },
        });
        if (response.ok) {
          const raw = (await response.json()) as Record<string, unknown>;
          await writeJson(profileFile, { ...raw, _source: "remote-api" });
          this.lastSource = "remote-api";
          this.logger.info("GBrain profile loaded (from remote API)");
          return extractGraph(raw);
        }
        throw new Error(`GBrain profile request returned ${response.status}`);
      } catch (error) {
        this.logger.error(`GBrain profile unavailable, using demo graph: ${(error as Error).message}`);
      }
    }

    this.lastSource = "demo";
    this.logger.info("GBrain profile loaded (demo mode)");
    return demoGraph();
  }

  private async queryLocalGBrain(): Promise<Record<string, unknown> | null> {
    try {
      const { stdout } = await execFileAsync(
        "gbrain",
        [
          "query",
          "summarize: my skills, what I'm building, what I need help with, my domain, what I care about",
          "--limit",
          "5",
        ],
        { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      );
      const text = stdout.trim();
      if (!text) {
        return null;
      }
      return await parseProfileWithClaude(text, this.config.anthropicApiKey, this.logger);
    } catch (error) {
      const message = (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "gbrain CLI not found"
        : (error as Error).message;
      this.logger.debug(`Skipping local GBrain query: ${message}`);
      return null;
    }
  }

  private baseUrl(): string {
    return this.config.gbrainBaseUrl ?? process.env.GBRAIN_BASE_URL ?? "https://api.gbrain.dev/v1";
  }
}

async function parseProfileWithClaude(
  rawText: string,
  apiKey: string | undefined,
  logger: AgentLogger,
): Promise<Record<string, unknown> | null> {
  if (!apiKey || apiKey.startsWith("demo_")) {
    logger.debug("No Anthropic key for profile parsing; using heuristic parse");
    return heuristicProfile(rawText);
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 900,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: [
            "Extract a structured profile from the GBrain query output below.",
            "Return ONLY valid JSON with these keys:",
            "  current_work (string), skills (string[]), needs (string[]),",
            "  domain (string), summary (string), interests (string[]),",
            "  projects (string[]), cares_about (string[]).",
            "Use concise phrases. If a field cannot be inferred, return an empty array or empty string.",
            "",
            "GBrain query output:",
            rawText,
          ].join("\n"),
        },
      ],
    });
    const text = response.content
      .map((block) => ("text" in block ? block.text : ""))
      .join("")
      .trim();
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch (error) {
    logger.debug(`Claude profile parse failed: ${(error as Error).message}`);
    return heuristicProfile(rawText);
  }
}

function heuristicProfile(rawText: string): Record<string, unknown> {
  return {
    summary: rawText.slice(0, 600),
    skills: [],
    needs: [],
    interests: [],
    projects: [],
    cares_about: [],
  };
}

export function extractGraph(raw: Record<string, unknown>): KnowledgeGraph {
  const capabilities = vectorFrom(raw);
  const caresAbout = dedupe(listValue(raw.cares_about ?? raw.caresAbout));
  if (caresAbout.length) {
    capabilities.interests = dedupe([...capabilities.interests, ...caresAbout]);
  }
  const summary =
    stringValue(raw.summary) ??
    stringValue(raw.bio) ??
    [
      `Offers: ${capabilities.offers.join(", ")}`,
      `Needs: ${capabilities.needs.join(", ")}`,
      `Projects: ${capabilities.projects.join(", ")}`,
    ].join("\n");

  return {
    summary,
    capabilities,
    people: listValue(raw.people),
    companies: listValue(raw.companies),
    problems: listValue(raw.problems ?? raw.stuck_on),
    searches: listValue(raw.searches ?? raw.looking_for),
    caresAbout: caresAbout.length ? caresAbout : undefined,
    domainReveal: {
      role: stringValue(raw.role),
      domain: stringValue(raw.domain),
      experience: stringValue(raw.experience),
      currentWork: stringValue(raw.current_work ?? raw.currentWork),
      lookingFor: stringValue(raw.looking_for ?? raw.lookingFor),
    },
    fullReveal: {
      name: stringValue(raw.name),
      company: stringValue(raw.company),
      role: stringValue(raw.role),
      contact: stringValue(raw.email ?? raw.contact),
    },
    raw,
  };
}

function vectorFrom(raw: Record<string, unknown>): CapabilityVector {
  return {
    offers: listValue(raw.offers ?? raw.skills ?? raw.skills_offered ?? raw.capabilities),
    needs: listValue(raw.needs ?? raw.skills_needed ?? raw.searching_for),
    interests: listValue(raw.interests ?? raw.topics),
    projects: listValue(raw.projects ?? raw.active_projects),
    constraints: listValue(raw.constraints),
  };
}

function listValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function hasMeaningfulProfileContent(raw: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("_")) continue;
    if (typeof value === "string" && value.trim()) return true;
    if (Array.isArray(value) && value.some((item) => typeof item === "string" ? item.trim() : Boolean(item))) {
      return true;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (hasMeaningfulProfileContent(value as Record<string, unknown>)) return true;
    }
    if (typeof value === "number" || typeof value === "boolean") return true;
  }
  return false;
}

function inferCachedSource(raw: Record<string, unknown>): ProfileSource {
  const marker = typeof raw._source === "string" ? raw._source : undefined;
  if (marker === "local-brain" || marker === "wizard" || marker === "remote-api" || marker === "cached" || marker === "demo") {
    return marker;
  }
  return "cached";
}

function labelFor(source: ProfileSource): string {
  switch (source) {
    case "local-brain": return "(from local brain)";
    case "wizard": return "(from wizard)";
    case "remote-api": return "(from remote API)";
    case "cached": return "(from cached profile)";
    case "demo": return "(demo mode)";
  }
}

export function demoGraph(): KnowledgeGraph {
  return {
    summary:
      "Speech ML builder with GPU cluster access, shipped React Native apps, and active interest in health-tech voice agents. Looking for medical data access, regulatory guidance, and collaborators building patient-facing workflows.",
    capabilities: {
      offers: ["GPU cluster access", "speech ML models", "Whisper fine-tunes", "React Native apps"],
      needs: ["medical datasets", "HIPAA compliance expertise", "health-tech partner"],
      interests: ["multimodal agents", "accessibility", "patient intake", "YC hackathons"],
      projects: ["HIPAA-compliant voice assistant", "mobile voice UI toolkit"],
    },
    people: ["NeurIPS 2024 multimodal workshop attendees", "YC founders"],
    companies: ["Open-source speech tooling", "health-tech startups"],
    problems: ["Need de-identified health data", "Need regulatory review for patient app"],
    searches: ["medical speech corpus", "spare cloud credits", "technical co-founder in health"],
    domainReveal: {
      role: "ML engineer and mobile builder",
      domain: "speech agents for healthcare and accessibility",
      experience: "8 years in applied ML, 3 shipped React Native apps",
      currentWork: "Building voice-first patient intake prototypes",
      lookingFor: "Medical data access, compliance expertise, and health-tech GTM context",
    },
    fullReveal: {
      name: "Demo GBrain User",
      company: "GBrain Network",
      role: "Founder/Builder",
      contact: "demo@gbrain.local",
    },
  };
}
