import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { open } from "node:fs/promises";
import { exec } from "node:child_process";
import { AgentLogger, LogEvent } from "./logger.js";
import { Identity } from "./types.js";
import { readJson } from "./storage.js";

interface DashState {
  peers: Array<{ id: string; pseudonym: string; source: string }>;
  matches: Array<{ peerId: string; pseudonym: string; score: number; collaboration: string; trustTier: number }>;
  sandboxes: Array<{ peerId: string; pseudonym: string; score: number; roundsComplete: number; brief?: string }>;
  events: LogEvent[];
}

const MAX_EVENTS = 120;

const HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>GBRAIN MISSION CONTROL</title>
<style>
  :root {
    --bg: #06060e;
    --panel: #0d0d1a;
    --border: #1a1a2e;
    --accent: #00ff88;
    --cyan: #00cfff;
    --purple: #8b5cf6;
    --yellow: #fbbf24;
    --red: #f87171;
    --text: #e2e8f0;
    --dim: #64748b;
    --font: 'JetBrains Mono', 'Fira Mono', 'Cascadia Code', monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    font-size: 12px;
    height: 100vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    background: var(--panel);
  }
  header h1 {
    font-size: 13px;
    letter-spacing: 0.15em;
    color: var(--accent);
    font-weight: 700;
  }
  .badge {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 3px;
    background: rgba(0,255,136,0.12);
    color: var(--accent);
    border: 1px solid rgba(0,255,136,0.25);
    letter-spacing: 0.08em;
  }
  .badge.dim { background: rgba(100,116,139,0.15); color: var(--dim); border-color: rgba(100,116,139,0.2); }
  .status-bar {
    display: flex;
    gap: 16px;
    align-items: center;
    font-size: 10px;
    color: var(--dim);
  }
  .dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; margin-right: 4px; }
  .dot.green { background: var(--accent); box-shadow: 0 0 6px var(--accent); animation: pulse 2s infinite; }
  .dot.dim { background: var(--dim); }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 1px;
    flex: 1;
    background: var(--border);
    overflow: hidden;
  }
  .panel {
    background: var(--panel);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .panel-title {
    font-size: 10px;
    letter-spacing: 0.12em;
    color: var(--dim);
    text-transform: uppercase;
    font-weight: 600;
  }
  .panel-body { flex: 1; overflow: hidden; position: relative; }

  /* NETWORK GRAPH */
  #network-svg { width: 100%; height: 100%; }
  .node-you circle { filter: drop-shadow(0 0 10px #00ff88); }
  .node-you text { fill: var(--bg); font-size: 10px; font-weight: 800; font-family: var(--font); }
  .node-peer circle { cursor: pointer; transition: filter 0.2s; }
  .node-peer circle.outer { opacity: 0.12; }
  .node-peer circle.inner:hover { filter: brightness(1.3) drop-shadow(0 0 8px #fff); }
  .node-peer text { fill: #fff; font-size: 9px; font-weight: 700; font-family: var(--font); pointer-events: none; }
  .edge { stroke: var(--border); stroke-width: 1; }
  .edge.active { stroke: rgba(0,255,136,0.3); stroke-width: 1.5; }
  .edge.matched { stroke: rgba(139,92,246,0.5); stroke-width: 2; stroke-dasharray: 4 3; animation: dash 1.5s linear infinite; }
  @keyframes dash { to { stroke-dashoffset: -14; } }
  .score-label { fill: var(--yellow); font-size: 9px; font-family: var(--font); }

  /* ACTIVITY FEED */
  #feed {
    height: 100%;
    overflow-y: auto;
    padding: 6px 0;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  .feed-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 3px 12px;
    border-left: 2px solid transparent;
    transition: background 0.15s;
  }
  .feed-row:hover { background: rgba(255,255,255,0.03); }
  .feed-row.new { animation: fadeIn 0.3s ease; }
  @keyframes fadeIn { from { opacity: 0; transform: translateX(-4px); } to { opacity: 1; } }
  .feed-row.peer { border-left-color: var(--cyan); }
  .feed-row.match { border-left-color: var(--accent); }
  .feed-row.sandbox { border-left-color: var(--purple); }
  .feed-row.error { border-left-color: var(--red); }
  .feed-time { color: var(--dim); flex-shrink: 0; width: 54px; }
  .feed-icon { flex-shrink: 0; width: 16px; text-align: center; }
  .feed-msg { color: var(--text); line-height: 1.5; word-break: break-word; }
  .feed-msg em { color: var(--dim); font-style: normal; }

  /* MATCHES LEADERBOARD */
  #matches-list { height: 100%; overflow-y: auto; padding: 6px 0; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
  .match-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.03);
    transition: background 0.15s;
  }
  .match-row:hover { background: rgba(255,255,255,0.04); }
  .match-rank { color: var(--dim); width: 18px; text-align: right; flex-shrink: 0; font-size: 10px; }
  .score-bar-wrap { width: 60px; flex-shrink: 0; }
  .score-bar-bg { height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; }
  .score-bar-fill { height: 100%; border-radius: 2px; background: linear-gradient(90deg, var(--purple), var(--accent)); transition: width 0.5s ease; }
  .score-val { font-size: 11px; font-weight: 700; color: var(--yellow); width: 28px; flex-shrink: 0; }
  .match-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .match-collab { color: var(--dim); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1.5; }
  .tier-chip {
    font-size: 9px; padding: 1px 5px; border-radius: 2px; flex-shrink: 0;
    background: rgba(139,92,246,0.2); color: var(--purple); border: 1px solid rgba(139,92,246,0.3);
  }
  .tier-chip.t2 { background: rgba(0,207,255,0.15); color: var(--cyan); border-color: rgba(0,207,255,0.3); }
  .tier-chip.t3 { background: rgba(0,255,136,0.15); color: var(--accent); border-color: rgba(0,255,136,0.3); }

  /* STATS PANEL */
  #stats-body { height: 100%; overflow-y: auto; padding: 10px 12px; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
  .stats-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.04);
  }
  .stats-label { color: var(--dim); }
  .stats-val { color: var(--text); font-weight: 600; }
  .stats-val.accent { color: var(--accent); }
  .stats-val.cyan { color: var(--cyan); }
  .sandbox-item { margin: 8px 0; }
  .sandbox-name { color: var(--text); margin-bottom: 3px; }
  .sandbox-progress { display: flex; gap: 3px; }
  .round-dot {
    width: 16px; height: 16px; border-radius: 3px; background: rgba(255,255,255,0.08);
    display: flex; align-items: center; justify-content: center; font-size: 8px; color: var(--dim);
  }
  .round-dot.done { background: var(--purple); color: white; }
  .round-dot.active { background: rgba(139,92,246,0.4); color: var(--purple); animation: pulse 1s infinite; }
  .section-head { color: var(--dim); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; margin: 12px 0 6px; }
  .brief-card {
    background: rgba(255,255,255,0.03); border: 1px solid var(--border);
    border-radius: 4px; padding: 8px 10px; margin: 6px 0;
    cursor: pointer; transition: background 0.15s, border-color 0.15s;
  }
  .brief-card:hover { background: rgba(0,255,136,0.06); border-color: rgba(0,255,136,0.25); }
  .brief-title { color: var(--accent); font-size: 11px; margin-bottom: 4px; }
  .brief-body { color: var(--dim); line-height: 1.5; }
  .brief-hint { color: var(--dim); font-size: 9px; margin-top: 4px; opacity: 0.6; }

  .empty { color: var(--dim); text-align: center; padding: 24px; font-size: 11px; }

  /* Modal */
  #modal-overlay {
    display: none; position: fixed; inset: 0;
    background: rgba(0,0,0,0.75); backdrop-filter: blur(4px);
    z-index: 100; align-items: center; justify-content: center;
  }
  #modal-overlay.open { display: flex; }
  #modal {
    background: #0d0d1a; border: 1px solid var(--border);
    border-radius: 8px; width: min(720px, 95vw); max-height: 85vh;
    display: flex; flex-direction: column; overflow: hidden;
    box-shadow: 0 0 40px rgba(0,255,136,0.08);
  }
  #modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  #modal-title { color: var(--accent); font-size: 13px; font-weight: 700; }
  #modal-close {
    background: none; border: none; color: var(--dim); cursor: pointer;
    font-size: 18px; line-height: 1; padding: 0 4px;
  }
  #modal-close:hover { color: var(--text); }
  #modal-body { overflow-y: auto; padding: 16px; flex: 1; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
  .modal-section { margin-bottom: 20px; }
  .modal-section-title { color: var(--dim); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 8px; }
  .modal-brief-desc { color: var(--text); line-height: 1.6; margin-bottom: 12px; }
  .modal-list { list-style: none; }
  .modal-list li { color: var(--dim); padding: 3px 0; }
  .modal-list li::before { content: "→ "; color: var(--cyan); }
  .round-block {
    border: 1px solid var(--border); border-radius: 4px; margin-bottom: 10px; overflow: hidden;
  }
  .round-header {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px; background: rgba(255,255,255,0.03);
    border-bottom: 1px solid var(--border); cursor: pointer;
  }
  .round-num {
    width: 20px; height: 20px; border-radius: 3px; background: var(--purple);
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 700; color: white; flex-shrink: 0;
  }
  .round-label { color: var(--text); flex: 1; font-size: 11px; }
  .round-toggle { color: var(--dim); font-size: 10px; }
  .round-body {
    padding: 10px 12px; color: var(--dim); line-height: 1.6; font-size: 11px;
    white-space: pre-wrap; word-break: break-word; display: none;
  }
  .round-body.open { display: block; }
</style>
</head>
<body>
<header>
  <div style="display:flex;align-items:center;gap:12px">
    <h1>⬡ GBRAIN MISSION CONTROL</h1>
    <span class="badge" id="agent-name">loading…</span>
  </div>
  <div class="status-bar">
    <span><span class="dot green" id="conn-dot"></span><span id="conn-label">LIVE</span></span>
    <span id="stat-peers">0 peers</span>
    <span id="stat-matches">0 matches</span>
    <span id="stat-sandboxes">0 sandboxes</span>
    <span id="clock"></span>
  </div>
</header>

<div class="grid">
  <!-- Panel 1: Network Graph -->
  <div class="panel">
    <div class="panel-header">
      <span class="panel-title">Network Graph</span>
      <span class="badge dim" id="net-count">0 nodes</span>
    </div>
    <div class="panel-body">
      <svg id="network-svg" xmlns="http://www.w3.org/2000/svg"></svg>
    </div>
  </div>

  <!-- Panel 2: Live Activity -->
  <div class="panel">
    <div class="panel-header">
      <span class="panel-title">Live Activity</span>
      <span class="badge dim" id="event-count">0 events</span>
    </div>
    <div class="panel-body">
      <div id="feed"></div>
    </div>
  </div>

  <!-- Panel 3: Match Leaderboard -->
  <div class="panel">
    <div class="panel-header">
      <span class="panel-title">Top Matches</span>
      <span class="badge dim" id="match-count">0</span>
    </div>
    <div class="panel-body">
      <div id="matches-list"><p class="empty">Discovering peers…</p></div>
    </div>
  </div>

  <!-- Panel 4: Sandbox + Stats -->
  <div class="panel">
    <div class="panel-header">
      <span class="panel-title">Sandbox + Stats</span>
      <span class="badge dim" id="sb-count">0 active</span>
    </div>
    <div class="panel-body">
      <div id="stats-body"></div>
    </div>
  </div>
</div>

<!-- Detail Modal -->
<div id="modal-overlay">
  <div id="modal">
    <div id="modal-header">
      <span id="modal-title">Collaboration Detail</span>
      <button id="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div id="modal-body"></div>
  </div>
</div>

<script>
const state = { peers: [], matches: [], sandboxes: [], events: [], agentName: '', agentId: '' };
let eventCount = 0;

function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function updateClock() { document.getElementById('clock').textContent = ts(); }
setInterval(updateClock, 1000);
updateClock();

// ── Fetch initial state ──────────────────────────────────────────────────────
async function fetchState() {
  try {
    const r = await fetch('/api/state');
    const data = await r.json();
    state.peers = data.peers || [];
    state.matches = data.matches || [];
    state.sandboxes = data.sandboxes || [];
    state.events = data.events || [];
    state.agentName = data.agentName || '';
    state.agentId = data.agentId || '';
    document.getElementById('agent-name').textContent = state.agentName || 'Agent';
    renderAll();
  } catch (e) { console.error('state fetch failed', e); }
}

// ── SSE ──────────────────────────────────────────────────────────────────────
function connectSSE() {
  const es = new EventSource('/events');
  es.onopen = () => {
    document.getElementById('conn-dot').classList.add('green');
    document.getElementById('conn-label').textContent = 'LIVE';
  };
  es.onerror = () => {
    document.getElementById('conn-dot').classList.remove('green');
    document.getElementById('conn-label').textContent = 'RECONNECTING';
    setTimeout(connectSSE, 2000);
    es.close();
  };
  es.addEventListener('event', (e) => {
    const ev = JSON.parse(e.data);
    handleEvent(ev);
  });
  es.addEventListener('state', (e) => {
    const data = JSON.parse(e.data);
    state.peers = data.peers || state.peers;
    state.matches = data.matches || state.matches;
    state.sandboxes = data.sandboxes || state.sandboxes;
    renderAll();
  });
}

function handleEvent(ev) {
  state.events.unshift(ev);
  if (state.events.length > 120) state.events.length = 120;
  eventCount++;
  document.getElementById('event-count').textContent = eventCount + ' events';

  // Re-fetch full state for events that add data not fully present in meta
  if (ev.type === 'peer:discovered' || ev.type === 'match:scored' || ev.type === 'sandbox:complete') {
    void fetchState();
  } else {
    if (ev.type === 'sandbox:started' && ev.meta?.peerId) {
      const exists = state.sandboxes.find(s => s.peerId === ev.meta.peerId);
      if (!exists) state.sandboxes.push({ peerId: ev.meta.peerId, pseudonym: '', score: 0, roundsComplete: 0 });
    }
    if (ev.type === 'sandbox:round' && ev.meta?.peerId) {
      const sb = state.sandboxes.find(s => s.peerId === ev.meta.peerId);
      if (sb) sb.roundsComplete = Number(ev.meta.round) || sb.roundsComplete;
    }
    renderStats();
  }
  appendFeedRow(ev);
}

// ── Feed ─────────────────────────────────────────────────────────────────────
const ICONS = {
  'peer:discovered': { icon: '⬡', cls: 'peer' },
  'profile:sent':    { icon: '→', cls: 'peer' },
  'match:scored':    { icon: '★', cls: 'match' },
  'sandbox:started': { icon: '⟳', cls: 'sandbox' },
  'sandbox:round':   { icon: '⟳', cls: 'sandbox' },
  'sandbox:complete':{ icon: '✓', cls: 'sandbox' },
  'match:ready':     { icon: '✓', cls: 'match' },
  'trust:updated':   { icon: '⬆', cls: 'peer' },
  'error':           { icon: '✗', cls: 'error' },
  'info':            { icon: '·', cls: '' },
  'debug':           { icon: '·', cls: '' },
};

function appendFeedRow(ev) {
  const feed = document.getElementById('feed');
  const { icon, cls } = ICONS[ev.type] || { icon: '·', cls: '' };
  const row = document.createElement('div');
  row.className = 'feed-row new' + (cls ? ' ' + cls : '');
  row.innerHTML =
    '<span class="feed-time">' + ts() + '</span>' +
    '<span class="feed-icon">' + icon + '</span>' +
    '<span class="feed-msg">' + escHtml(ev.message) + '</span>';
  feed.insertBefore(row, feed.firstChild);
  if (feed.children.length > 120) feed.removeChild(feed.lastChild);
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderFeed() {
  const feed = document.getElementById('feed');
  feed.innerHTML = '';
  for (const ev of state.events) appendFeedRow(ev);
}

// ── Network Graph ─────────────────────────────────────────────────────────────
function renderNetwork() {
  const svg = document.getElementById('network-svg');
  const w = svg.clientWidth || 300;
  const h = svg.clientHeight || 300;
  const cx = w / 2, cy = h / 2;
  const peers = state.peers;
  const matchMap = {};
  for (const m of state.matches) matchMap[m.peerId] = m;

  const nodes = peers.map((p, i) => {
    const angle = (2 * Math.PI * i) / Math.max(peers.length, 1) - Math.PI / 2;
    const r = Math.min(cx, cy) * 0.62;
    return { ...p, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });

  // Derive gradient colors from pseudonym — mirrors gradientForPseudonym() in identity.ts
  function pseudonymGradient(pseudonym) {
    const hex = pseudonym.replace('#', '').padEnd(4, '0').slice(0, 4);
    return { from: '#' + hex.slice(0, 2) + 'A9FF', to: '#' + hex.slice(2, 4) + '3AFF' };
  }

  // Build <defs> with one radialGradient per peer
  let defs = '<defs>';
  for (const n of nodes) {
    const g = pseudonymGradient(n.pseudonym);
    const gid = 'pg-' + n.id.slice(0, 8);
    defs += \`<radialGradient id="\${gid}" cx="35%" cy="35%" r="65%">
      <stop offset="0%" stop-color="\${g.from}"/>
      <stop offset="100%" stop-color="\${g.to}"/>
    </radialGradient>\`;
  }
  defs += '</defs>';

  let html = defs;
  for (const n of nodes) {
    const m = matchMap[n.id];
    const edgeCls = m ? 'edge matched' : 'edge active';
    const g = pseudonymGradient(n.pseudonym);
    const edgeColor = m ? g.to : 'rgba(100,116,139,0.4)';
    html += \`<line class="\${edgeCls}" x1="\${cx}" y1="\${cy}" x2="\${n.x}" y2="\${n.y}" stroke="\${edgeColor}" stroke-dashoffset="0"/>\`;
  }
  for (const n of nodes) {
    const m = matchMap[n.id];
    const gid = 'pg-' + n.id.slice(0, 8);
    const g = pseudonymGradient(n.pseudonym);
    const glowColor = g.to;
    html += \`<g class="node-peer">
      <circle class="outer" cx="\${n.x}" cy="\${n.y}" r="30" style="fill:\${glowColor}"/>
      <circle class="inner" cx="\${n.x}" cy="\${n.y}" r="22" style="fill:url(#\${gid});stroke:\${g.from};stroke-width:1.5;stroke-opacity:0.6"/>
      <text x="\${n.x}" y="\${n.y + 4}" text-anchor="middle" font-size="9" font-weight="700" font-family="monospace">\${escHtml(n.pseudonym)}</text>
    </g>\`;
    if (m) {
      const mx = (cx + n.x) / 2, my = (cy + n.y) / 2;
      html += \`<text class="score-label" x="\${mx}" y="\${my - 4}" text-anchor="middle">\${m.score}</text>\`;
    }
  }
  // Center node (YOU)
  html += \`<defs><radialGradient id="you-grad" cx="35%" cy="35%" r="65%"><stop offset="0%" stop-color="#80ffcc"/><stop offset="100%" stop-color="#00ff88"/></radialGradient></defs>
  <g class="node-you">
    <circle cx="\${cx}" cy="\${cy}" r="36" style="fill:#00ff88;opacity:0.1"/>
    <circle cx="\${cx}" cy="\${cy}" r="26" style="fill:url(#you-grad);stroke:#00ff88;stroke-width:1.5;stroke-opacity:0.7"/>
    <text x="\${cx}" y="\${cy + 4}" text-anchor="middle" style="fill:#06060e" font-size="10" font-weight="800" font-family="monospace">YOU</text>
  </g>\`;

  svg.innerHTML = html || \`<text x="\${cx}" y="\${cy}" text-anchor="middle" fill="#64748b" font-size="11" font-family="monospace">Scanning local network…</text>\`;
  document.getElementById('net-count').textContent = peers.length + ' node' + (peers.length !== 1 ? 's' : '');
}

// ── Matches ───────────────────────────────────────────────────────────────────
function tierClass(t) { return t === 3 ? 't3' : t === 2 ? 't2' : ''; }
function tierLabel(t) { return t === 3 ? 'T3' : t === 2 ? 'T2' : 'T1'; }

function peerColor(pseudonym) {
  const hex = pseudonym.replace('#', '').padEnd(4, '0').slice(0, 4);
  return '#' + hex.slice(0, 2) + 'A9FF';
}

function renderMatches() {
  const el = document.getElementById('matches-list');
  document.getElementById('match-count').textContent = state.matches.length;
  if (!state.matches.length) {
    el.innerHTML = '<p class="empty">Scoring peers…</p>';
    return;
  }
  el.innerHTML = state.matches.map((m, i) => {
    const color = peerColor(m.pseudonym);
    return \`<div class="match-row">
      <span class="match-rank">#\${i + 1}</span>
      <span class="score-val">\${m.score}</span>
      <div class="score-bar-wrap"><div class="score-bar-bg"><div class="score-bar-fill" style="width:\${m.score}%;background:linear-gradient(90deg,\${color},var(--accent))"></div></div></div>
      <span class="match-name" style="color:\${color}">\${escHtml(m.pseudonym)}</span>
      <span class="match-collab">\${escHtml(m.collaboration || '—')}</span>
      <span class="tier-chip \${tierClass(m.trustTier)}">\${tierLabel(m.trustTier)}</span>
    </div>\`;
  }).join('');
}

// ── Stats + Sandboxes ─────────────────────────────────────────────────────────
function renderStats() {
  const el = document.getElementById('stats-body');
  document.getElementById('sb-count').textContent = state.sandboxes.length + ' active';

  const t2 = state.matches.filter(m => m.trustTier >= 2).length;
  const t3 = state.matches.filter(m => m.trustTier >= 3).length;
  const complete = state.sandboxes.filter(s => s.roundsComplete >= 3);

  let html = \`
    <div class="stats-row"><span class="stats-label">Peers discovered</span><span class="stats-val accent">\${state.peers.length}</span></div>
    <div class="stats-row"><span class="stats-label">Matches scored</span><span class="stats-val accent">\${state.matches.length}</span></div>
    <div class="stats-row"><span class="stats-label">Tier 2 unlocked</span><span class="stats-val cyan">\${t2}</span></div>
    <div class="stats-row"><span class="stats-label">Tier 3 (meet)</span><span class="stats-val" style="color:var(--accent)">\${t3}</span></div>
    <div class="stats-row"><span class="stats-label">Sandboxes complete</span><span class="stats-val" style="color:var(--purple)">\${complete.length}</span></div>
  \`;

  if (state.sandboxes.length) {
    html += '<div class="section-head">Sandbox Progress</div>';
    for (const sb of state.sandboxes) {
      const rounds = [1, 2, 3];
      html += \`<div class="sandbox-item">
        <div class="sandbox-name">\${escHtml(sb.pseudonym)}</div>
        <div class="sandbox-progress">\${rounds.map(r => {
          const cls = sb.roundsComplete >= 3 ? 'done' : r < sb.roundsComplete ? 'done' : r === sb.roundsComplete ? 'active' : '';
          return \`<div class="round-dot \${cls}">\${r}</div>\`;
        }).join('')}</div>
      </div>\`;
    }
  }

  // Briefs from completed sandboxes
  const briefs = state.sandboxes.filter(s => s.brief);
  if (briefs.length) {
    html += '<div class="section-head">Collaboration Briefs</div>';
    for (const sb of briefs) {
      const color = peerColor(sb.pseudonym);
      html += \`<div class="brief-card" onclick="openModal('\${escHtml(sb.peerId)}', '\${escHtml(sb.pseudonym)}')">
        <div class="brief-title" style="color:\${color}">\${escHtml(sb.brief)}</div>
        <div class="brief-body" style="color:var(--dim);font-size:10px">\${escHtml(sb.pseudonym)}</div>
        <div class="brief-hint">Click to view emails ↗</div>
      </div>\`;
    }
  }

  if (!state.sandboxes.length && !state.matches.length) {
    html += '<p class="empty" style="margin-top:16px">Waiting for first peer match…</p>';
  }

  el.innerHTML = html;
}

function renderAll() {
  renderFeed();
  renderNetwork();
  renderMatches();
  renderStats();
  updateCounts();
}

function updateCounts() {
  document.getElementById('stat-peers').textContent = state.peers.length + ' peers';
  document.getElementById('stat-matches').textContent = state.matches.length + ' matches';
  document.getElementById('stat-sandboxes').textContent = state.sandboxes.length + ' sandboxes';
}

// ── Modal ─────────────────────────────────────────────────────────────────────
const ROUND_LABELS = ['Introducing — exchanging capability vectors', 'Exploring — project context + collaboration ideas', 'Proposing — concrete collaboration brief'];

async function openModal(peerId, pseudonym) {
  const overlay = document.getElementById('modal-overlay');
  const body = document.getElementById('modal-body');
  const title = document.getElementById('modal-title');
  title.textContent = 'Loading ' + pseudonym + '…';
  title.style.color = peerColor(pseudonym);
  body.innerHTML = '<p class="empty">Fetching conversation…</p>';
  overlay.classList.add('open');

  try {
    const r = await fetch('/api/sandbox/' + peerId);
    if (!r.ok) throw new Error('not found');
    const sb = await r.json();
    title.textContent = pseudonym + ' — ' + (sb.brief?.title || 'Collaboration');

    const match = state.matches.find(m => m.peerId === peerId);
    const score = match?.score ?? sb.score ?? '—';

    let html = \`<div class="modal-section">
      <div class="modal-section-title">Collaboration Brief</div>
      <div class="modal-brief-desc">\${escHtml(sb.brief?.whatWeWouldBuild || '')}</div>\`;

    if (sb.brief?.eachContributes?.length) {
      html += '<div class="modal-section-title">Contributions</div><ul class="modal-list">';
      for (const c of sb.brief.eachContributes) html += \`<li>\${escHtml(String(c))}</li>\`;
      html += '</ul>';
    }
    if (sb.brief?.eachGets?.length) {
      html += '<div class="modal-section-title" style="margin-top:10px">Each gets</div><ul class="modal-list">';
      for (const c of sb.brief.eachGets) html += \`<li>\${escHtml(String(c))}</li>\`;
      html += '</ul>';
    }
    if (sb.brief?.nonObviousConnections?.length) {
      html += '<div class="modal-section-title" style="margin-top:10px">Why this is non-obvious</div><ul class="modal-list">';
      for (const c of sb.brief.nonObviousConnections) html += \`<li>\${escHtml(String(c))}</li>\`;
      html += '</ul>';
    }
    html += '</div>';

    html += \`<div class="modal-section">
      <div class="modal-section-title">3-Round Agent Conversation  ·  Score \${score}</div>\`;

    const rounds = Array.isArray(sb.rounds) ? sb.rounds : [];
    for (let i = 0; i < 3; i++) {
      const rd = rounds[i];
      const label = ROUND_LABELS[i] || ('Round ' + (i+1));
      const done = !!rd;
      html += \`<div class="round-block">
        <div class="round-header" onclick="toggleRound(this)">
          <div class="round-num" style="background:\${done ? 'var(--purple)' : 'var(--border)'}">\${i+1}</div>
          <span class="round-label">\${label}</span>
          <span class="round-toggle">\${done ? '▶ expand' : 'pending'}</span>
        </div>
        <div class="round-body">\${done ? escHtml(rd.response) : 'Not yet completed.'}</div>
      </div>\`;
    }
    html += '</div>';
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = '<p class="empty">Could not load conversation data.</p>';
  }
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

function toggleRound(header) {
  const body = header.nextElementSibling;
  const toggle = header.querySelector('.round-toggle');
  const isOpen = body.classList.toggle('open');
  toggle.textContent = isOpen ? '▼ collapse' : '▶ expand';
}

// Close modal when clicking outside
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// ── Boot ──────────────────────────────────────────────────────────────────────
fetchState().then(() => {
  connectSSE();
  // Redraw network on resize
  window.addEventListener('resize', renderNetwork);
});
</script>
</body>
</html>`;

export class MissionControlServer {
  private server: ReturnType<typeof createServer> | null = null;
  private readonly sseClients = new Set<ServerResponse>();
  private readonly recentEvents: LogEvent[] = [];
  private state: DashState = { peers: [], matches: [], sandboxes: [], events: [] };
  private agentName = "";

  constructor(
    private readonly logger: AgentLogger,
    private readonly port: number,
    identity: Identity,
  ) {
    this.agentName = `${identity.pseudonym} #${identity.pseudonym.slice(-4).toUpperCase()}`;
    this.logger.on("event", (ev: LogEvent) => {
      this.recentEvents.unshift(ev);
      if (this.recentEvents.length > MAX_EVENTS) this.recentEvents.length = MAX_EVENTS;
      this.broadcast("event", ev);
    });
  }

  async start(opts: { openBrowser?: boolean } = {}): Promise<void> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => {
      this.server!.listen(this.port, "127.0.0.1", () => resolve());
    });
    if (opts.openBrowser !== false) {
      openBrowser(`http://127.0.0.1:${this.port}`);
    }
  }

  stop(): void {
    for (const client of this.sseClients) client.end();
    this.sseClients.clear();
    this.server?.close();
  }

  pushState(): void {
    this.broadcast("state", {
      peers: this.state.peers,
      matches: this.state.matches,
      sandboxes: this.state.sandboxes,
    });
  }

  updateState(partial: Partial<DashState>): void {
    Object.assign(this.state, partial);
    this.pushState();
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    if (req.url === "/events") {
      this.handleSSE(req, res);
    } else if (req.url === "/api/state") {
      void this.handleState(res);
    } else if (req.url?.startsWith("/api/sandbox/")) {
      const peerId = req.url.slice("/api/sandbox/".length);
      void this.handleSandboxDetail(peerId, res);
    } else {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(HTML);
    }
  }

  private handleSSE(_req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("retry: 2000\n\n");
    this.sseClients.add(res);
    _req.on("close", () => this.sseClients.delete(res));
  }

  private async handleState(res: ServerResponse): Promise<void> {
    // Pull fresh from disk for initial load
    const peersRaw = await readJson<Record<string, Record<string, unknown>> | Array<Record<string, unknown>>>("peers.json", {});
    const matches = await readJson<Record<string, Record<string, unknown>>>("matches.json", {});
    const sandboxes = await readJson<Record<string, Record<string, unknown>>>("sandboxes.json", {});

    const peersArr = (Array.isArray(peersRaw) ? peersRaw : Object.values(peersRaw)).map((p) => ({ id: String(p.id ?? ""), pseudonym: String(p.pseudonym ?? ""), source: String(p.source ?? "mdns") }));
    const matchesArr = Object.values(matches).map((m) => ({
      peerId: String(m.peerId ?? ""),
      pseudonym: String(m.pseudonym ?? ""),
      score: Number(m.score ?? 0),
      collaboration: String(m.collaboration ?? ""),
      trustTier: Number(m.trustTier ?? 1),
    })).sort((a, b) => b.score - a.score);
    const sandboxesArr = Object.values(sandboxes).map((s) => ({
      peerId: String(s.peerId ?? ""),
      pseudonym: String(s.pseudonym ?? ""),
      score: Number(s.score ?? 0),
      roundsComplete: Array.isArray(s.rounds) ? (s.rounds as unknown[]).length : 0,
      brief: (s.brief as Record<string, unknown>)?.title ? String((s.brief as Record<string, unknown>).title) : undefined,
    }));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      agentName: this.agentName,
      peers: peersArr,
      matches: matchesArr,
      sandboxes: sandboxesArr,
      events: this.recentEvents.slice(0, 60),
    }));
  }

  private async handleSandboxDetail(peerId: string, res: ServerResponse): Promise<void> {
    const sandboxes = await readJson<Record<string, unknown>>("sandboxes.json", {});
    const sb = sandboxes[peerId];
    if (!sb) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(sb));
  }

  private broadcast(eventName: string, data: unknown): void {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      try { client.write(payload); } catch { this.sseClients.delete(client); }
    }
  }
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === "darwin" ? `open "${url}"` : platform === "win32" ? `start "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {/* ignore errors */});
}
