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
npx gbrain-agent doctor      # preflight: API keys, ports, mDNS, state dir
npx gbrain-agent start
```

`start` automatically runs the preflight checks first and aborts on hard failures. Use `--skip-doctor` if you intentionally want to skip them, or `doctor --skip-network` to run only the local checks.

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

Then run `npx gbrain-agent start --pace demo` from another terminal on the same machine/network.

### Make the demo "cook"

By default the agent runs at full speed — useful for tests, but the live activity stream flashes by in under a second. For live demos, pace the orchestrator so events are visible:

```bash
npx gbrain-agent start --pace demo   # 1.4s between rounds, 0.7s between peers
npx gbrain-agent start --pace slow   # 2.4s between rounds, 1.2s between peers
npx gbrain-agent start --pace 2000   # custom: 2s between rounds + peers
```

Pacing only inserts dwell between visible events; it never blocks Primitive sends or LLM calls.

### Reset between runs

The agent caches matches, sandboxes, and discovered peers under `state/`. For a fresh demo, clear it:

```bash
npx gbrain-agent reset                    # keeps identity + config (default)
npx gbrain-agent reset --no-keep-identity # also rotates the pseudonym/keypair
npx gbrain-agent reset --no-keep-config   # also forgets stored API keys
```

## Troubleshooting

If the demo misbehaves, run the doctor first:

```bash
npx gbrain-agent doctor
```

It reports on:

- Node.js runtime (>= 20)
- Primitive API key + sender (warns on demo/example values)
- GBrain API key (warns on demo keys; live ping if a real key is present)
- Anthropic key shape
- `state/` directory writability
- Webhook port availability (only if `GBRAIN_WEBHOOK_PORT` is pinned)
- mDNS / Bonjour publish capability

Common fixes:

- **Doctor reports port in use** — another agent is still running, or pick a different `GBRAIN_WEBHOOK_PORT`.
- **mDNS warning on a VM / locked-down network** — multicast is blocked. Use `simulate` on the same host and run `start` from a sibling shell.
- **`Claude response did not contain parseable JSON`** — the agent now logs the failure and falls back to the local deterministic matcher/brief, so the demo continues. Re-run `reset` and try again with a fresh prompt.
- **Demo too fast / nothing visible** — add `--pace demo`.
- **Repeat run shows nothing new** — `npx gbrain-agent reset`, then re-run.

## Cross-network connect

When mDNS can't reach a peer (different WiFi, remote laptop), send a handshake over Primitive email:

```bash
npx gbrain-agent connect --to peer@sub.primitive.email
```

Pin the webhook port with `GBRAIN_WEBHOOK_PORT=8080`, then `ngrok http 8080` and paste the URL into your Primitive dashboard so responses route back.

## Profile source

On start the agent looks for, in order:

1. `state/profile.json` (cached structured profile),
2. `gbrain query` output from the local [GBrain CLI](https://gbrain.dev) (parsed by Claude into the matching schema),
3. a 4-question interactive wizard (when no profile and no CLI),
4. a demo profile fallback (CI / non-TTY).

## Environment

- `PRIMITIVE_API_KEY` — Primitive email API key
- `PRIMITIVE_WEBHOOK_SECRET` — Primitive webhook signing secret
- `PRIMITIVE_FROM` or `PRIMITIVE_EMAIL` — verified Primitive sender address
- `GBRAIN_API_KEY` — GBrain API key
- `ANTHROPIC_API_KEY` — Claude API key

Runtime state is persisted under `state/` and ignored by git.
