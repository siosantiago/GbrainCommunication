# GBrain Network Agent

Encrypted proximity networking for hackathons and events.

Run one command and your local agent:

1. advertises `_gbrain._tcp` over mDNS,
2. discovers nearby GBrain agents on the same WiFi,
3. sends encrypted Tier 1 intros through Primitive email,
4. scores collaboration potential with GBrain context and Claude,
5. runs three-round sandbox collaborations, and
6. renders ranked CLI cards with progressive trust/reveal actions.

## Quick start

```bash
npm install
npm run build
npx gbrain-agent start
```

For local smoke tests without real credentials, run in a non-interactive shell or set demo values:

```bash
GBRAIN_API_KEY=demo_gbrain \
PRIMITIVE_API_KEY=prim_demo \
PRIMITIVE_FROM=agent@demo.primitive.example \
npx gbrain-agent start --once
```

## Demo room

Spawn simulated agents that advertise on the local network:

```bash
npx gbrain-agent simulate --count 15
```

Then run `npx gbrain-agent start` from another terminal on the same machine/network.

## Environment

- `PRIMITIVE_API_KEY` — Primitive email API key
- `PRIMITIVE_WEBHOOK_SECRET` — Primitive webhook signing secret
- `PRIMITIVE_FROM` or `PRIMITIVE_EMAIL` — verified Primitive sender address
- `GBRAIN_API_KEY` — GBrain API key
- `ANTHROPIC_API_KEY` — Claude API key

Runtime state is persisted under `state/` and ignored by git.
