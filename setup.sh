#!/usr/bin/env bash
set -euo pipefail

# ─── colours ────────────────────────────────────────────────────────────────
BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
RESET='\033[0m'

echo ""
echo -e "${BOLD}GBrain Agent — Setup${RESET}"
echo -e "${DIM}Takes 60 seconds. Writes a .env file you can open and edit anytime.${RESET}"
echo ""

# ─── Step 1: Primitive API key ───────────────────────────────────────────────
echo -e "${BOLD}Step 1/4 — Primitive API key${RESET}"
echo -e "${DIM}  Find it at: primitive.dev → Settings → API keys${RESET}"
read -rp "  API key (prim_...): " PRIMITIVE_API_KEY
echo ""

# ─── Step 2: Sender email ────────────────────────────────────────────────────
echo -e "${BOLD}Step 2/4 — Your agent's email address${RESET}"
echo -e "${DIM}  This is the address your agent sends FROM.${RESET}"
echo -e "${DIM}  You have two domains on your Primitive account:${RESET}"
echo -e "${DIM}    a)  agent@dry-breeze.primitive.email${RESET}"
echo -e "${DIM}    b)  agent@agent.rascacielos.app${RESET}"
read -rp "  Sender address: " PRIMITIVE_FROM
echo ""

# ─── Step 3: LLM API key ─────────────────────────────────────────────────────
echo -e "${BOLD}Step 3/4 — OpenAI API key${RESET}"
echo -e "${DIM}  Used to parse your GBrain knowledge into a structured profile${RESET}"
echo -e "${DIM}  and to score matches. Get one at: platform.openai.com/api-keys${RESET}"
echo -e "${DIM}  (Claude key also works — sk-ant-...)${RESET}"
read -rp "  API key (sk-...): " OPENAI_API_KEY
echo ""

# ─── Step 4: Webhook secret (optional) ───────────────────────────────────────
echo -e "${BOLD}Step 4/4 — Primitive webhook secret${RESET}"
echo -e "${DIM}  Used to verify inbound emails. Get it from:${RESET}"
echo -e "${DIM}  primitive.dev → Domains → [your domain] → Webhooks tab${RESET}"
echo -e "${DIM}  Press Enter to skip for now (you can add it later in .env)${RESET}"
read -rp "  Webhook secret (optional): " PRIMITIVE_WEBHOOK_SECRET
echo ""

# ─── Write .env ───────────────────────────────────────────────────────────────
ENV_FILE="$(cd "$(dirname "$0")" && pwd)/.env"

cat > "$ENV_FILE" <<EOF
# GBrain Agent — credentials
# Edit this file any time, then run: node dist/cli.js setup

PRIMITIVE_API_KEY=${PRIMITIVE_API_KEY}
PRIMITIVE_FROM=${PRIMITIVE_FROM}
PRIMITIVE_WEBHOOK_SECRET=${PRIMITIVE_WEBHOOK_SECRET}

# LLM key (Claude: sk-ant-... | OpenAI: sk-... or sk-proj-...)
OPENAI_API_KEY=${OPENAI_API_KEY}

# Webhook port — keep this fixed so your ngrok/localtunnel URL stays stable
GBRAIN_WEBHOOK_PORT=64320
EOF

echo -e "${GREEN}✓${RESET} .env file written to:"
echo -e "  ${CYAN}${ENV_FILE}${RESET}"
echo ""

# ─── Show the file ────────────────────────────────────────────────────────────
echo -e "${DIM}Contents:${RESET}"
echo -e "${DIM}─────────────────────────────────────────${RESET}"
# Print file, masking secret values
while IFS= read -r line; do
  if [[ "$line" =~ ^[A-Z_]+=.{8,} ]]; then
    key="${line%%=*}"
    val="${line#*=}"
    masked="${val:0:6}$(printf '%0.s*' {1..8})${val: -4}"
    echo -e "${DIM}  ${key}=${masked}${RESET}"
  else
    echo -e "${DIM}  ${line}${RESET}"
  fi
done < "$ENV_FILE"
echo -e "${DIM}─────────────────────────────────────────${RESET}"
echo ""

# ─── Open the file ────────────────────────────────────────────────────────────
if command -v open &>/dev/null; then
  echo -e "${DIM}Opening .env in your default editor…${RESET}"
  open "$ENV_FILE"
fi

# ─── Apply config ─────────────────────────────────────────────────────────────
echo -e "${BOLD}Applying config…${RESET}"
node "$(cd "$(dirname "$0")" && pwd)/dist/cli.js" setup
echo ""

# ─── Build profile from GBrain ───────────────────────────────────────────────
echo -e "${BOLD}Building your profile from GBrain…${RESET}"
echo -e "${DIM}  This queries your local brain and uses your LLM key to extract${RESET}"
echo -e "${DIM}  your skills, needs, and projects into a structured profile.${RESET}"
node "$(cd "$(dirname "$0")" && pwd)/dist/cli.js" profile refresh
echo ""
echo -e "${BOLD}You're ready. Run:${RESET}"
echo -e "  ${CYAN}gbrain-agent start${RESET}"
echo ""
