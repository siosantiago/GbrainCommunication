import { AgentConfig, CapabilityVector, KnowledgeGraph } from "./types.js";
import { AgentLogger } from "./logger.js";

export class GBrainClient {
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
    if (!this.config.gbrainApiKey || this.config.gbrainApiKey.startsWith("demo_")) {
      return demoGraph();
    }

    try {
      const response = await fetch(`${this.baseUrl()}/profile`, {
        headers: {
          Authorization: `Bearer ${this.config.gbrainApiKey}`,
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`GBrain profile request returned ${response.status}`);
      }
      const raw = (await response.json()) as Record<string, unknown>;
      return extractGraph(raw);
    } catch (error) {
      this.logger.error(`GBrain profile unavailable, using demo graph: ${(error as Error).message}`);
      return demoGraph();
    }
  }

  private baseUrl(): string {
    return this.config.gbrainBaseUrl ?? process.env.GBRAIN_BASE_URL ?? "https://api.gbrain.dev/v1";
  }
}

export function extractGraph(raw: Record<string, unknown>): KnowledgeGraph {
  const capabilities = vectorFrom(raw);
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
