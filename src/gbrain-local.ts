import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { KnowledgeGraph } from "./types.js";
import { extractGraph } from "./gbrain.js";

const execFileAsync = promisify(execFile);

const GBRAIN_QUERY_PROMPT = [
  "You are helping build a hackathon networking profile.",
  "Return ONLY valid JSON (no markdown fences) with these keys:",
  '  "current_work": string — what they are building now',
  '  "skills": string[] — skills/resources they can offer',
  '  "needs": string[] — what they are looking for',
  '  "domain": string — their domain',
  '  "projects": string[] — active projects',
  '  "summary": string — one paragraph collaboration summary',
  "Base answers on the user's brain content. Be specific and factual.",
].join("\n");

export type ProfileSource = "local_gbrain" | "profile_json" | "demo";

export async function isLocalGbrainAvailable(): Promise<boolean> {
  try {
    await access(join(homedir(), ".gbrain", "config.json"));
    await execFileAsync("which", ["gbrain"]);
    return true;
  } catch {
    return false;
  }
}

export async function importProfileFromLocalGbrain(): Promise<KnowledgeGraph | null> {
  if (!(await isLocalGbrainAvailable())) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync("gbrain", ["query", GBRAIN_QUERY_PROMPT, "--no-expand"], {
      timeout: 45_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const raw = parseJsonFromStdout(stdout);
    if (!raw) {
      return null;
    }
    return extractGraph(normalizeProfileRaw(raw));
  } catch {
    return null;
  }
}

function parseJsonFromStdout(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeProfileRaw(raw: Record<string, unknown>): Record<string, unknown> {
  const skills = listFrom(raw.skills ?? raw.offers);
  const needs = listFrom(raw.needs);
  const projects = listFrom(raw.projects);
  const currentWork = stringFrom(raw.current_work ?? raw.currentWork);

  return {
    ...raw,
    current_work: currentWork,
    skills,
    needs,
    projects,
    summary:
      stringFrom(raw.summary) ??
      [
        currentWork ? `Building: ${currentWork}.` : "",
        skills.length ? `Offers: ${skills.join(", ")}.` : "",
        needs.length ? `Needs: ${needs.join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
  };
}

function listFrom(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
