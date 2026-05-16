# GBrain Network Agent

> Your agent talks to every other agent in the room — before you meet anyone.

Walk into a hackathon, an event, or get on the same WiFi as someone interesting. Both agents discover each other, exchange encrypted profiles, score collaboration potential with Claude, run three rounds of sandbox collaboration — and hand you a ranked list of who you should meet and exactly why.

All of this happens before you say a word to anyone.

---

## The Loop

```
You run one command
        ↓
Agent broadcasts on local network (mDNS)
        ↓
Discovers other GBrain agents nearby
        ↓
Exchanges encrypted Tier 1 profiles via Primitive email
        ↓
Claude scores collaboration potential (0–100)
        ↓
Top matches enter a 3-round sandbox collaboration
        ↓
You get ranked CLI cards — score, why you match, what to build
        ↓
Press T to reveal more · Y to meet · P to pass
```

---

## What You Need

| Requirement | Get it at | Notes |
|-------------|-----------|-------|
| **Primitive API key** | [primitive.dev](https://primitive.dev) → Settings → API keys | Free tier works |
| **Primitive sender address** | Same account | e.g. `agent@your-org.primitive.email` |
| **Anthropic API key** | [console.anthropic.com](https://console.anthropic.com) | Optional — falls back to keyword matching |
| **Node.js 20+** | [nodejs.org](https://nodejs.org) | |

No GBrain account required. The agent collects your profile interactively on first run.

---

## Quick Start

```bash
git clone https://github.com/siosantiago/GbrainCommunication
cd GbrainCommunication
npm install
npm run build
npx gbrain-agent start
```

On first run you'll be walked through a 4-step setup:

```
Welcome to GBrain Network
Let's get your agent running in under 60 seconds.

Step 1/4: Primitive email
  API key (prim_...): ████████████████████
  Sender address: agent@your-org.primitive.email
  ✓ Primitive configured

Step 2/4: Claude API (for smart matching)
  Anthropic key (sk-ant-...): ████████████████████
  ✓ Claude matching enabled

Step 3/4: Your profile
  What are you building or working on right now?
  → Building an AI agent for health data workflows

  What can you offer? (skills, resources, access, connections)
  comma separated → ML engineering, GPU cluster, React Native, healthcare domain

  What are you actively looking for or stuck on?
  comma separated → medical datasets, regulatory expertise, technical co-founder

  Your domain → health tech

Step 4/4: Identity (for Tier 3 reveal only)
  Your name: Santiago Jaramillo
  Your role: Founder & CEO

  ✓ Profile saved

✓ Profile loaded (4 skills · 3 needs · 1 project)
✓ Primitive email active (agent@your-org.primitive.email)
✓ mDNS broadcasting (_gbrain._tcp)
✓ Encryption keys generated (x25519 ephemeral keypair)

Your agent is live. Scanning for nearby agents...
  Pseudonym: #7F3A
```

---

## Trust Tiers

Your agent never reveals who you are until you explicitly consent.

| Tier | What's shared | How to reach it |
|------|--------------|-----------------|
| **Tier 1** (everyone) | Encrypted capability/need vectors only. No names, no details. | Automatic on discovery |
| **Tier 2** (mutual match) | Domain-level info — role, experience, current project. Still pseudonymous. | Both agents flag interest → press `T` |
| **Tier 3** (opt-in reveal) | Full profile. Real name, contact, company. | Both people press `Y` |

Communication always flows through agents via Primitive email — never raw direct contact until Tier 3.

---

## Match Cards

When your agent finishes sandboxing, it prints a ranked list:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ #1 — #B2D1    Score: 97                                                  │
├──────────────────────────────────────────────────────────────────────────┤
│ Collaboration: HIPAA-compliant voice assistant for patient intake         │
│ They bring: Medical dataset access + regulatory/compliance expertise      │
│ You bring: GPU cluster + speech ML models + React Native                 │
│                                                                          │
│ Why you match:                                                           │
│ → They have the medical speech corpus you flagged as needed 2 weeks ago  │
│ → You both attended the NeurIPS 2024 multimodal agents workshop          │
│ → They need React Native help — you've shipped 3 RN apps                │
│                                                                          │
│ Trust: ■□□ Tier 1 (anonymous)                                            │
├──────────────────────────────────────────────────────────────────────────┤
│  T  Upgrade to Tier 2    R  Read full brief    Y  Meet    P  Pass        │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Update Your Profile

Your profile is saved in `state/profile.json`.

```bash
# Interactive wizard (recommended for hackathon demo)
npx gbrain-agent profile wizard

# Optional: try importing from local gbrain CLI (~/.gbrain)
npx gbrain-agent profile pull
```

If `profile pull` fails, use the wizard — local `gbrain query` returns search snippets, not structured JSON, on many brains.

---

## Demo Room (No Real People Required)

Test the full loop on a single machine by spawning simulated agents:

```bash
# Terminal 1: start 10 fake agents
npx gbrain-agent simulate --count 10

# Terminal 2: run your real agent
npx gbrain-agent start
```

Your agent will discover all 10 simulated agents, match against their profiles, run sandbox collaborations, and print CLI cards — no WiFi partners needed.

---

## Smoke Test (CI / No Credentials)

```bash
PRIMITIVE_API_KEY=prim_demo \
PRIMITIVE_FROM=agent@demo.primitive.example \
node dist/cli.js start --once --logs
```

Runs setup in demo mode, starts mDNS, processes any peers found, and exits. Useful for verifying the build works without real keys.

---

## Flags

| Flag | Command | What it does |
|------|---------|-------------|
| `--silent` | `start` | Suppress live activity stream; show only final match cards |
| `--logs` | `start`, `simulate` | Verbose mDNS packets, Primitive API calls, LLM prompts |
| `--once` | `start` | Process existing peers and exit (smoke test mode) |
| `--count N` | `simulate` | Number of simulated agents to spawn (default: 15) |

---

## Environment Variables

All settings can be provided via `.env` or environment variables. The interactive setup wizard saves them to `state/config.json` so you only configure once.

```bash
PRIMITIVE_API_KEY=prim_...          # Required
PRIMITIVE_FROM=you@org.primitive.email  # Required
PRIMITIVE_WEBHOOK_SECRET=...        # Optional — verifies inbound signatures
ANTHROPIC_API_KEY=sk-ant-...        # Optional — enables Claude matching
GBRAIN_API_KEY=gbrain_...           # Optional — pulls live GBrain profile
GBRAIN_WEBHOOK_PORT=8080            # Optional — pin webhook port (useful for ngrok)
```

---

## Two-Laptop Live Demo

1. Both laptops on the **same WiFi** (or a phone hotspot — guest WiFi often blocks mDNS).
2. Copy [`.env.example`](.env.example) → `.env` on each machine with **different** Primitive orgs/addresses.
3. Run `npx gbrain-agent profile wizard` on each laptop.
4. Start a tunnel on each laptop and set the webhook URL in Primitive dashboard.
5. On both: `npx gbrain-agent start --logs`
6. Expect `Discovered #XXXX` on each side within ~30s, then match cards.

Branch for this work: `feature/hackathon-demo-profile`.

## Hosting the Webhook

Primitive delivers inbound emails to your agent via webhook POST. For two agents to fully negotiate (not just send), the webhook must be publicly reachable.

**Fastest path: ngrok**

```bash
# Pin the port first
export GBRAIN_WEBHOOK_PORT=8080

# Start tunnel
ngrok http 8080

# Set the printed URL in Primitive dashboard
# primitive.dev → Settings → Webhooks → https://abc123.ngrok.io/webhooks/email
```

**Persistent: Cloudflare Tunnel (free, stable URL)**

```bash
cloudflared tunnel --url http://localhost:8080
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     gbrain-agent start                       │
│                                                              │
│  ┌──────────┐   mDNS    ┌──────────┐                        │
│  │ Discovery │ ◄──────► │ Peer     │  bonjour-service        │
│  │ Service  │           │ Registry │                         │
│  └────┬─────┘           └──────────┘                        │
│       │ peer discovered                                      │
│       ▼                                                      │
│  ┌─────────────┐  Primitive  ┌──────────────┐               │
│  │ Orchestrator│ ──email───► │  Transport   │  @primitivedotdev/sdk  │
│  │             │ ◄──webhook─ │  + Webhook   │               │
│  └──────┬──────┘             └──────────────┘               │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────┐             ┌──────────────┐               │
│  │   Matcher   │ ──Claude──► │  Sandbox     │  3-round      │
│  │  (scoring)  │             │ Orchestrator │  collaboration │
│  └─────────────┘             └──────────────┘               │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────┐                                            │
│  │   Display   │  CLI cards, progress, trust tiers          │
│  └─────────────┘                                            │
└─────────────────────────────────────────────────────────────┘

State: state/ (gitignored)
  config.json · profile.json · identity.json · peers.json
  matches.json · sandboxes.json · trust_levels.json
```

---

## Stack

- **TypeScript / Node.js 20+**
- **bonjour-service** — mDNS advertisement and discovery
- **@primitivedotdev/sdk** — Primitive email send/receive
- **@anthropic-ai/sdk** — Claude for matching and sandbox generation
- **tweetnacl** — x25519 authenticated encryption
- **express** — local webhook server for inbound Primitive emails
- **chalk / ora** — terminal UI

---

## Contributing

1. Fork this repo
2. `npm install && npm run build`
3. `npx gbrain-agent start` — runs the setup wizard
4. `npx gbrain-agent simulate --count 5` in another terminal to test discovery
5. Open a PR

Profile your changes with `--logs`. Match scoring is in `src/matching.ts`, sandbox rounds in `src/sandbox.ts`, trust tiers in `src/trust.ts`.

---

Built with [Primitive](https://primitive.dev) · [Claude](https://anthropic.com) · [GBrain](https://gbrain.dev)
