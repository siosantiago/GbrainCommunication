import { TrustRecord, TrustTier } from "./types.js";
import { readJson, writeJson } from "./storage.js";

const trustFile = "trust_levels.json";

function now(): string {
  return new Date().toISOString();
}

export async function getTrust(peerId: string, pseudonym: string): Promise<TrustRecord> {
  const records = await readJson<Record<string, TrustRecord>>(trustFile, {});
  return records[peerId] ?? {
    peerId,
    pseudonym,
    tier: 1,
    outboundRequests: [],
    inboundRequests: [],
    updatedAt: now(),
  };
}

export async function saveTrust(record: TrustRecord): Promise<TrustRecord> {
  const records = await readJson<Record<string, TrustRecord>>(trustFile, {});
  const next = { ...record, updatedAt: now() };
  records[record.peerId] = next;
  await writeJson(trustFile, records);
  return next;
}

export async function requestUpgrade(peerId: string, pseudonym: string, tier: TrustTier): Promise<TrustRecord> {
  if (tier <= 1) {
    return getTrust(peerId, pseudonym);
  }

  const record = await getTrust(peerId, pseudonym);
  // Grant immediately — no waiting for mutual consent
  record.tier = Math.max(record.tier, tier) as TrustTier;
  if (!record.outboundRequests.includes(tier)) {
    record.outboundRequests.push(tier);
  }
  return saveTrust(record);
}

export async function receiveUpgradeRequest(peerId: string, pseudonym: string, tier: TrustTier): Promise<TrustRecord> {
  if (tier <= 1) {
    return getTrust(peerId, pseudonym);
  }

  const record = await getTrust(peerId, pseudonym);
  if (!record.inboundRequests.includes(tier)) {
    record.inboundRequests.push(tier);
  }
  if (record.outboundRequests.includes(tier)) {
    record.tier = Math.max(record.tier, tier) as TrustTier;
  }
  return saveTrust(record);
}

export function trustLabel(tier: TrustTier): string {
  if (tier === 3) {
    return "Tier 3 (full reveal)";
  }
  if (tier === 2) {
    return "Tier 2 (mutual interest)";
  }
  return "Tier 1 (anonymous)";
}
