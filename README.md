# GBrain Network Agent

**Encrypted proximity networking for AI agents.**

Drop this on your laptop at a hackathon, conference, or team offsite. Within seconds your agent discovers nearby peers over local WiFi, exchanges encrypted capability profiles, scores collaboration potential with Claude, and runs three-round AI-driven sandbox conversations — all without anyone sharing a contact or clicking a link.

---

## What it does

| Step | What happens |
|------|-------------|
| **Discover** | Broadcasts `_gbrain._tcp` over mDNS — peers appear as they join the same WiFi |
| **Handshake** | Sends an x25519-encrypted Tier 1 intro through Primitive email |
| **Score** | Claude reads both capability graphs and produces a 0–100 match score |
| **Sandbox** | Three-round AI conversation explores what a real collaboration would look like |
| **Rank** | Terminal cards + live web dashboard show who to talk to first |

---

## Quick start

```bash
npm install
npm run build

# First run — configure credentials interactively
npx gbrain-agent setup

# Launch your agent
npx gbrain-agent start
```

Environment variables (alternative to interactive setup):

```bash
export PRIMITIVE_API_KEY=prim_...
export PRIMITIVE_FROM=you@yoursubdomain.primitive.email
export ANTHROPIC_API_KEY=sk-ant-...   # or OPENAI_API_KEY=sk-proj-...
export GBRAIN_WEBHOOK_PORT=64320      # port ngrok/localtunnel will forward to
```

---

## Two-agent demo on one machine

The full handshake → score → sandbox loop, entirely local:

```bash
# Terminal 1 — primary agent
node dist/cli.js start

# Terminal 2 — second agent (isolated state directory)
GBRAIN_STATE_DIR=$(pwd)/state2 GBRAIN_WEBHOOK_PORT=64321 node dist/cli.js start

# Terminal 3 — 10 simulated peers, one every 5 seconds
node dist/cli.js simulate --count 10 --stagger 5
```

Or run the all-in-one launcher that opens every window automatically:

```bash
./start-demo.sh
```

The launcher starts both agents, simulated peers, and two webhook tunnels, and prints the Mission Control dashboard URLs.

---

## Trust tiers

Profiles are revealed progressively — no information is shared before both sides agree.

| Tier | What's shared | How to reach it |
|------|--------------|-----------------|
| **Tier 1** | Anonymous capability graph (skills, needs, projects — no name or domain) | Automatic on discovery |
| **Tier 2** | Role + domain reveal | Both agents score ≥ 70 and mutual interest confirmed |
| **Tier 3** | Full name and contact | Explicit `T` keypress in the terminal UI after Tier 2 |

---

## Architecture

```
┌─────────────────── GBrain Network Agent ───────────────────┐
│                                                             │
│  mDNS Discovery ──► Orchestrator ──► Matcher (Claude LLM)  │
│       │                  │                    │             │
│  Bonjour _gbrain._tcp    │             Score 0-100          │
│                    Primitive Email             │             │
│                    (x25519 encrypted)   SandboxOrchestrator │
│                          │             (3-round AI convo)   │
│                    Webhook Server              │             │
│                    (inbound messages)   MatchResult + Brief  │
│                                               │             │
│                    ┌──────────────────────────┤             │
│                    │   MISSION CONTROL        │             │
│                    │   SSE → Browser UI       │             │
│                    │   Network graph + Briefs │             │
│                    └──────────────────────────┘             │
└─────────────────────────────────────────────────────────────┘
```

**Key design decisions:**

- **Primitive email** is used as the transport for encrypted agent handshakes — it provides verifiable sender identity without requiring direct TCP connections between peers.
- **x25519 ephemeral keypairs** are generated fresh on each run — no long-term key management required.
- **mDNS** (Bonjour `_gbrain._tcp`) gives instant zero-config discovery on the same WiFi segment.
- **LLM-agnostic** — auto-detects `sk-ant-*` (Claude) vs `sk-proj-*` (OpenAI) and routes accordingly.
- **Serialized file writes** — a promise-chain lock per filename prevents `peers.json` corruption under concurrent peer discovery.

---

## MISSION CONTROL

A live web dashboard opens automatically at `http://127.0.0.1:64420` (port is `webhookPort + 100`).

```
┌─────────────────────────────────────────────────────────────────┐
│  GBRAIN MISSION CONTROL                              ● LIVE     │
├──────────────────────┬──────────────────────────────────────────┤
│                      │                                          │
│   Network Graph      │   Live Activity Stream                   │
│   (SVG, per-peer     │   ● mDNS peer discovered · dry-breeze   │
│    gradient colors)  │   ● profile:sent → [GBrain #513C]       │
│                      │   ● match:scored → 84 pts               │
├──────────────────────┼──────────────────────────────────────────┤
│                      │                                          │
│   Top Matches        │   Active Sandboxes                       │
│   #1 pseudonym  84   │   ● dry-breeze ○ ○ ●  Round 3           │
│   #2 pseudonym  71   │                                          │
│                      │   Collaboration Briefs  (click to open) │
│   Stats              │   ┌─────────────────────────────────┐   │
│   Peers: 10          │   │  Brief title                    │   │
│   Matches: 8         │   │  pseudonym · 84 pts             │   │
│   Sandboxes: 6       │   └─────────────────────────────────┘   │
└──────────────────────┴──────────────────────────────────────────┘
```

Each brief card is clickable and opens a modal with the full three-round sandbox conversation and collaboration summary.

---

## Terminal UI

```
┌──────────────────────────────────────────────────────────────────────────┐
│ #1 — dry-breeze #513C    Score: 84                                       │
├──────────────────────────────────────────────────────────────────────────┤
│ Collaboration: Build an AI-native observability layer for health-tech     │
│ They bring: Clinical data pipelines + compliance expertise                │
│ You bring: LLM orchestration + developer tooling                          │
│                                                                           │
│ Why you match (from GBrain):                                              │
│ → Both tackling the same data-trust problem from opposite ends            │
│ → Non-obvious: your event-sourcing background maps to their audit trail   │
│ → Shared interest in privacy-preserving ML inference                      │
│ → Complementary networks: US west coast vs EU health market               │
│                                                                           │
│ Trust: ■■□ mutual interest confirmed                                      │
├──────────────────────────────────────────────────────────────────────────┤
│  T  Upgrade to Tier 2    R  Read full brief    P  Pass                    │
└──────────────────────────────────────────────────────────────────────────┘
```

After all peers are processed, a final ranking prints automatically:

```
━━ WHO TO COLLABORATE WITH FIRST ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
★ #1  dry-breeze #513C  84pts
     Build an AI-native observability layer for health-tech
     → Your event-sourcing background maps directly to their audit trail need
  #2  rascacielos #72B7  71pts
     Co-develop privacy-preserving inference pipeline
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Setup

### 1. Prerequisites

- Node.js 20+
- A [Primitive](https://primitive.email) account with a verified sender domain
- Claude API key (`sk-ant-...`) **or** OpenAI API key (`sk-proj-...`)
- `ngrok` or `npx localtunnel` for webhook forwarding (only needed for cross-network handshakes)

### 2. Install and build

```bash
git clone https://github.com/siosantiago/GbrainCommunication
cd GbrainCommunication
npm install && npm run build
```

### 3. Configure

```bash
npx gbrain-agent setup
```

The wizard asks for:

1. Primitive API key (`prim_...`)
2. Primitive sender address (`you@yoursubdomain.primitive.email`)
3. LLM API key (Claude `sk-ant-...` or OpenAI `sk-proj-...`)
4. Webhook port (default `64320`)
5. Primitive webhook signing secret (from your Primitive dashboard → Webhooks tab)

### 4. Wire up the webhook

```bash
ngrok http 64320
# Copy the https://xxx.ngrok.io URL → Primitive dashboard → your domain → Webhooks → <url>/webhooks/email
```

### 5. Start

```bash
npx gbrain-agent start
```

---

## Sandbox conversations

Each matched pair runs three AI-driven rounds before producing a collaboration brief.

| Round | What happens |
|-------|-------------|
| **Round 1 — Introduce** | Each agent describes what they are working on and what they are looking for |
| **Round 2 — Explore** | Agents probe for non-obvious connections and shared context |
| **Round 3 — Propose** | Agents draft a concrete first step for collaboration |

The final brief includes: a title, what each party brings, what each gets, non-obvious connections, and a concrete next action.

All LLM calls use anonymized graphs (no real names or identifying details) during the sandbox. Identity is only revealed when the user explicitly upgrades to Tier 3.

---

## Simulated agents

For demos and development without real peers:

```bash
# 10 agents, one every 5 seconds
npx gbrain-agent simulate --count 10 --stagger 5
```

Simulated agents advertise realistic capability profiles (founders, engineers, researchers across diverse domains), go through the full score + sandbox flow, and produce real collaboration briefs. A random 20% of peers are skipped to simulate natural agent selectivity.

---

## Commands

| Command | Description |
|---------|-------------|
| `gbrain-agent start` | Start the agent (mDNS + webhook listener) |
| `gbrain-agent start --silent` | Suppress live activity, show only final results |
| `gbrain-agent start --logs` | Verbose mDNS, Primitive, and LLM diagnostics |
| `gbrain-agent start --once` | Process existing peers once and exit (smoke test) |
| `gbrain-agent start --no-browser` | Skip auto-opening the Mission Control tab |
| `gbrain-agent connect --to peer@sub.primitive.email` | Send a handshake to a specific peer |
| `gbrain-agent simulate --count N --stagger S` | Spawn N simulated peers, S seconds apart |
| `gbrain-agent profile show` | Print the current structured profile |
| `gbrain-agent profile refresh` | Re-query gbrain CLI and re-parse with Claude |
| `gbrain-agent setup` | Reconfigure credentials (preserves identity and peers) |

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `PRIMITIVE_API_KEY` | Primitive email API key |
| `PRIMITIVE_FROM` | Verified Primitive sender address |
| `PRIMITIVE_WEBHOOK_SECRET` | Primitive webhook signing secret |
| `ANTHROPIC_API_KEY` | Claude API key (for profile parsing + matching) |
| `OPENAI_API_KEY` | OpenAI API key (alternative to Claude) |
| `GBRAIN_API_KEY` | GBrain API key |
| `GBRAIN_STATE_DIR` | Override state directory (default: `./state`) |
| `GBRAIN_WEBHOOK_PORT` | Override webhook port (default: `64320`) |

---

## State files

All runtime state lives under `state/` (gitignored).

| File | Contents |
|------|----------|
| `config.json` | Credentials and configuration |
| `identity.json` | Pseudonym and agent ID |
| `crypto_identity.json` | x25519 keypair |
| `profile.json` | Structured GBrain capability profile |
| `peers.json` | All discovered peers |
| `peer_profiles.json` | Cached remote peer profiles |
| `matches.json` | Scored match results |
| `sandboxes.json` | Completed sandbox conversations and briefs |

---

## Contributing

```
src/
  cli.ts           — yargs command definitions
  index.ts         — agent startup and wiring
  orchestrator.ts  — peer lifecycle and decision logic
  discovery.ts     — mDNS advertising and scanning
  transport.ts     — Primitive email send/receive
  webhook.ts       — inbound webhook HTTP server
  matching.ts      — LLM-based match scoring
  sandbox.ts       — three-round AI conversation engine
  web-server.ts    — Mission Control SSE dashboard
  gbrain.ts        — GBrain CLI integration and profile loading
  setup.ts         — interactive wizard and config management
  identity.ts      — pseudonym generation and identity persistence
  crypto.ts        — x25519 keypair management
  llm.ts           — LLM provider abstraction (Claude / OpenAI)
  display.ts       — terminal rendering (chalk, box art)
  storage.ts       — JSON state persistence with write serialization
  simulate.ts      — simulated peer agent spawner
  trust.ts         — trust tier labels and logic
  types.ts         — shared TypeScript types
```

```bash
npm run build      # compile TypeScript
npm run typecheck  # type-check without emit
npm run lint       # eslint
```

---

## License

MIT
