#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Reset ─────────────────────────────────────────────────────────────────────
pkill -f "node.*dist/cli" 2>/dev/null || true
sleep 0.5
for STATE in "$DIR/state" "$DIR/state2"; do
  for FILE in peers.json peer_profiles.json matches.json sandboxes.json; do
    rm -f "$STATE/$FILE"
  done
done

# ── Write per-agent launch scripts (avoids osascript path-wrapping issues) ────
cat > /tmp/gbrain_agent1.sh << SCRIPT
#!/bin/bash
echo ""
echo "=== Agent 1: Santiago / dry-breeze (#513C) ==="
echo ""
cd "$DIR"
node dist/cli.js start --logs
SCRIPT

cat > /tmp/gbrain_agent2.sh << SCRIPT
#!/bin/bash
echo ""
echo "=== Agent 2: Health-tech / rascacielos (#72B7) ==="
echo ""
cd "$DIR"
GBRAIN_STATE_DIR="$DIR/state2" GBRAIN_WEBHOOK_PORT=64321 node dist/cli.js start --logs --no-browser
SCRIPT

cat > /tmp/gbrain_simulate.sh << SCRIPT
#!/bin/bash
echo ""
echo "=== Simulated Agents (5 peers, appearing every 10s) ==="
echo ""
cd "$DIR"
sleep 8
node dist/cli.js simulate --count 10 --stagger 5
SCRIPT

chmod +x /tmp/gbrain_simulate.sh

chmod +x /tmp/gbrain_agent1.sh /tmp/gbrain_agent2.sh

# ── Check if ngrok is already running on 64320 ────────────────────────────────
NGROK_RUNNING=false
if curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | grep -q "64320"; then
  NGROK_RUNNING=true
fi

# ── Open Terminal windows ─────────────────────────────────────────────────────
if [ "$NGROK_RUNNING" = "true" ]; then
  # ngrok already running — only open 4 windows (skip ngrok)
  osascript <<APPLESCRIPT
tell application "Terminal"
  activate
  do script "echo ''; echo '=== Tab 2: localtunnel — Agent 2 (port 64321) ==='; echo 'Copy URL below → Primitive → agent.rascacielos.app → Webhooks → <url>/webhooks/email'; echo ''; npx localtunnel --port 64321"
  do script "bash /tmp/gbrain_agent1.sh"
  do script "bash /tmp/gbrain_agent2.sh"
  do script "bash /tmp/gbrain_simulate.sh"
end tell
APPLESCRIPT
  echo ""
  echo "ngrok already running — reusing existing tunnel."
else
  # Open all 5 windows
  osascript <<APPLESCRIPT
tell application "Terminal"
  activate
  do script "echo ''; echo '=== Tab 1: ngrok — Agent 1 (port 64320) ==='; echo 'Copy URL → Primitive → dry-breeze.primitive.email → Webhooks → <url>/webhooks/email'; echo ''; ngrok http 64320"
  do script "echo ''; echo '=== Tab 2: localtunnel — Agent 2 (port 64321) ==='; echo 'Copy URL → Primitive → agent.rascacielos.app → Webhooks → <url>/webhooks/email'; echo ''; npx localtunnel --port 64321"
  do script "bash /tmp/gbrain_agent1.sh"
  do script "bash /tmp/gbrain_agent2.sh"
  do script "bash /tmp/gbrain_simulate.sh"
end tell
APPLESCRIPT
fi

echo ""
echo "Done. Windows opened."
echo ""
if [ "$NGROK_RUNNING" = "true" ]; then
  echo "  ngrok URL (reuse): check http://127.0.0.1:4040 for the current URL"
fi
echo "  After tunnels show URLs → update Primitive dashboard webhooks → agents connect automatically"
echo ""
echo "  ── GBRAIN MISSION CONTROL ──────────────────────────────────"
echo "  Agent 1 (dry-breeze)  →  http://127.0.0.1:64420"
echo "  Agent 2 (rascacielos) →  http://127.0.0.1:64421"
echo "  (dashboards open automatically in browser when agents start)"
echo ""
