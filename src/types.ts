export type LogLevel = "silent" | "default" | "verbose";

export interface AgentConfig {
  gbrainApiKey: string;
  primitiveApiKey: string;
  primitiveFrom: string;
  primitiveWebhookSecret?: string;
  anthropicApiKey?: string;
  gbrainBaseUrl?: string;
  webhookPort?: number;
}

export interface Identity {
  pseudonym: string;
  gradient: {
    from: string;
    to: string;
  };
  createdAt: string;
}

export interface CryptoIdentity {
  publicKey: string;
  secretKey: string;
}

export interface Peer {
  id: string;
  pseudonym: string;
  address?: string;
  port?: number;
  primitiveEmail: string;
  publicKey: string;
  firstSeenAt: string;
  lastSeenAt: string;
  source: "mdns" | "simulated" | "manual";
}

export interface CapabilityVector {
  offers: string[];
  needs: string[];
  interests: string[];
  projects: string[];
  constraints?: string[];
}

export interface DomainReveal {
  role?: string;
  domain?: string;
  experience?: string;
  currentWork?: string;
  lookingFor?: string;
}

export interface FullReveal {
  name?: string;
  company?: string;
  role?: string;
  contact?: string;
}

export interface KnowledgeGraph {
  summary: string;
  capabilities: CapabilityVector;
  people: string[];
  companies: string[];
  problems: string[];
  searches: string[];
  domainReveal: DomainReveal;
  fullReveal: FullReveal;
  raw?: unknown;
}

export interface TierOnePayload {
  version: 1;
  type: "tier1_profile";
  fromPseudonym: string;
  fromEmail: string;
  publicKey: string;
  graph: Pick<KnowledgeGraph, "summary" | "capabilities">;
  sentAt: string;
}

export type TrustTier = 1 | 2 | 3;

export interface TrustRecord {
  peerId: string;
  pseudonym: string;
  tier: TrustTier;
  outboundRequests: TrustTier[];
  inboundRequests: TrustTier[];
  updatedAt: string;
}

export interface MatchResult {
  peerId: string;
  pseudonym: string;
  score: number;
  collaboration: string;
  theyBring: string[];
  youBring: string[];
  reasons: string[];
  trustTier: TrustTier;
  createdAt: string;
}

export interface SandboxRound {
  round: 1 | 2 | 3;
  prompt: string;
  response: string;
  completedAt: string;
}

export interface SandboxResult {
  peerId: string;
  pseudonym: string;
  threadId?: string;
  messageId?: string;
  score: number;
  rounds: SandboxRound[];
  brief: CollaborationBrief;
  completedAt: string;
}

export interface CollaborationBrief {
  title: string;
  whatWeWouldBuild: string;
  eachContributes: string[];
  eachGets: string[];
  nonObviousConnections: string[];
}

export interface PrimitiveMessage {
  id?: string;
  messageId?: string;
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  inReplyTo?: string;
  references?: string[];
}

export interface AgentOptions {
  silent: boolean;
  logs: boolean;
  simulateCount?: number;
}
