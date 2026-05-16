import { randomBytes } from "node:crypto";
import { Identity } from "./types.js";
import { readJson, writeJson } from "./storage.js";

const identityFile = "identity.json";

export function generatePseudonym(): string {
  return `#${randomBytes(2).toString("hex").toUpperCase()}`;
}

export function gradientForPseudonym(pseudonym: string): Identity["gradient"] {
  const hex = pseudonym.replace("#", "").padEnd(4, "0").slice(0, 4);
  const first = hex.slice(0, 2);
  const second = hex.slice(2, 4);

  return {
    from: `#${first}A9FF`,
    to: `#${second}3AFF`,
  };
}

export async function loadOrCreateIdentity(): Promise<Identity> {
  const existing = await readJson<Identity | null>(identityFile, null);
  if (existing?.pseudonym) {
    return existing;
  }

  const pseudonym = generatePseudonym();
  const identity: Identity = {
    pseudonym,
    gradient: gradientForPseudonym(pseudonym),
    createdAt: new Date().toISOString(),
  };
  await writeJson(identityFile, identity);
  return identity;
}

export async function handlePseudonymCollision(collidingPseudonym: string): Promise<Identity> {
  const current = await loadOrCreateIdentity();
  if (current.pseudonym !== collidingPseudonym) {
    return current;
  }

  let next = generatePseudonym();
  while (next === collidingPseudonym) {
    next = generatePseudonym();
  }

  const identity: Identity = {
    pseudonym: next,
    gradient: gradientForPseudonym(next),
    createdAt: current.createdAt,
  };
  await writeJson(identityFile, identity);
  return identity;
}

export function badgeText(identityOrPseudonym: Identity | string): string {
  return typeof identityOrPseudonym === "string"
    ? identityOrPseudonym
    : identityOrPseudonym.pseudonym;
}
