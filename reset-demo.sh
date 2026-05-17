#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
DIM='\033[2m'
RESET='\033[0m'

echo ""
echo -e "${BOLD}GBrain Demo Reset${RESET}"
echo -e "${DIM}Kills agents, clears runtime state, keeps credentials and profiles.${RESET}"
echo ""

# ── Kill any running agents (not ngrok/localtunnel — reuse those) ────────────
echo -e "${BOLD}Stopping agents…${RESET}"
if pkill -f "node.*dist/cli" 2>/dev/null; then
  echo -e "  ${GREEN}✓${RESET} Killed running agent processes"
  sleep 1
else
  echo -e "  ${DIM}  No agent processes running${RESET}"
fi

# ── Clean runtime state (both agents) ───────────────────────────────────────
echo -e "${BOLD}Clearing runtime state…${RESET}"
for DIR_PATH in "$DIR/state" "$DIR/state2"; do
  for FILE in peers.json peer_profiles.json matches.json sandboxes.json; do
    rm -f "$DIR_PATH/$FILE"
  done
  echo -e "  ${GREEN}✓${RESET} ${DIR_PATH##*/}/ cleared"
done

# ── Verify profiles are intact ───────────────────────────────────────────────
echo ""
echo -e "${BOLD}Agent 1 profile (Santiago / dry-breeze):${RESET}"
node -e "
const p = require('$DIR/state/profile.json');
console.log('  Summary:', p.summary.slice(0, 90) + '...');
console.log('  Skills: ', p.skills.slice(0,3).join(', '));
console.log('  Needs:  ', p.needs.slice(0,2).join(', '));
" 2>/dev/null || echo -e "  ${YELLOW}⚠ No profile found — wizard will run on start${RESET}"

echo ""
echo -e "${BOLD}Agent 2 profile (health-tech / rascacielos):${RESET}"
node -e "
const p = require('$DIR/state2/profile.json');
console.log('  Summary:', p.summary.slice(0, 90) + '...');
console.log('  Skills: ', p.skills.slice(0,3).join(', '));
console.log('  Needs:  ', p.needs.slice(0,2).join(', '));
" 2>/dev/null || echo -e "  ${YELLOW}⚠ No profile found — wizard will run on start${RESET}"

# ── Print next steps ─────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}Ready. Open 4 terminal tabs and run:${RESET}"
echo ""
echo -e "  ${BOLD}Tab 1 — ngrok tunnel (port 64320, Agent 1)${RESET}"
echo -e "  ${DIM}If ngrok is already running → reuse its URL, skip this step.${RESET}"
echo -e "  ${CYAN}ngrok http 64320${RESET}${DIM}   ← only if not already running${RESET}"
echo -e "  ${DIM}→ Primitive dashboard → dry-breeze.primitive.email → Webhooks${RESET}"
echo -e "  ${DIM}  set: https://<ngrok-url>/webhooks/email${RESET}"
echo ""
echo -e "  ${BOLD}Tab 2 — localtunnel (port 64321, Agent 2)${RESET}"
echo -e "  ${CYAN}npx localtunnel --port 64321${RESET}"
echo -e "  ${DIM}→ copy URL → Primitive dashboard → agent.rascacielos.app → Webhooks${RESET}"
echo -e "  ${DIM}  set to: https://<your-url>/webhooks/email${RESET}"
echo ""
echo -e "  ${BOLD}Tab 3 — Agent 1 (Santiago / dry-breeze)${RESET}"
echo -e "  ${CYAN}cd $DIR && node dist/cli.js start --logs${RESET}"
echo ""
echo -e "  ${BOLD}Tab 4 — Agent 2 (health-tech / rascacielos)${RESET}"
echo -e "  ${CYAN}cd $DIR && GBRAIN_STATE_DIR=$DIR/state2 GBRAIN_WEBHOOK_PORT=64321 node dist/cli.js start --logs${RESET}"
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${DIM}Expected flow (60-90 seconds after both agents start):${RESET}"
echo -e "${DIM}  ● mDNS: both agents discover each other on WiFi${RESET}"
echo -e "${DIM}  ● Tier 1 encrypted profile emails exchanged via Primitive${RESET}"
echo -e "${DIM}  ● LLM scores match (expect 75-95 for this pair)${RESET}"
echo -e "${DIM}  ● 3-round sandbox collaboration brief generated${RESET}"
echo -e "${DIM}  ● Match card appears on both consoles${RESET}"
echo -e "${DIM}  ● Press N to navigate · T for Tier 2 · R to read brief · Y to meet${RESET}"
echo ""
