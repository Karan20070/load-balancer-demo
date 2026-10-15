// Educational load balancer: fake servers + balancing algorithms + live dashboard (SSE).
// No dependencies. Run: node server.js  ->  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 3000;

/* ---------- Fake backend servers (different sizes so algorithms behave differently) ---------- */
const servers = [
  { name: 'server-1', weight: 5, latency: 80,  capacity: 20 },
  { name: 'server-2', weight: 3, latency: 120, capacity: 15 },
  { name: 'server-3', weight: 2, latency: 200, capacity: 10 },
  { name: 'server-4', weight: 1, latency: 60,  capacity: 8  },
].map((s, id) => ({
  ...s, id, healthy: true, active: 0, total: 0, received: 0, errors: 0,
  lastReceived: 0, rps: 0, avgLatency: 0, current: 0, history: [],
}));

// A fake server "handles" a request by waiting. It slows down as it fills up,
// and rejects (503) when it is down or at capacity.
function handle(s) {
  s.received++;
  return new Promise((resolve) => {
    if (!s.healthy || s.active >= s.capacity) { s.errors++; return resolve({ ok: false, server: s.name }); }
    s.active++;
    const ms = s.latency * (1 + s.active / s.capacity) * (0.8 + Math.random() * 0.4);
    setTimeout(() => {
      s.active--; s.total++;
      s.avgLatency = s.avgLatency ? s.avgLatency * 0.9 + ms * 0.1 : ms;
      resolve({ ok: true, server: s.name, ms: Math.round(ms) });
    }, ms);
  });
}

/* ---------- Load balancing algorithms ---------- */
let rrIndex = 0;
const algorithms = {
  'round-robin': (pool) => pool[rrIndex++ % pool.length],
  // Smooth weighted round robin (same idea as nginx)
  'weighted-round-robin': (pool) => {
    const total = pool.reduce((t, s) => t + s.weight, 0);
    pool.forEach((s) => (s.current += s.weight));
    const best = pool.reduce((a, b) => (b.current > a.current ? b : a));
    best.current -= total;
    return best;
  },
  'least-connections': (pool) => pool.reduce((a, b) => (b.active < a.active ? b : a)),
  'random': (pool) => pool[Math.floor(Math.random() * pool.length)],
  // Same client IP always lands on the same server (sticky sessions)
  'ip-hash': (pool, ip) => {
    let h = 0;
    for (const c of ip) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return pool[h % pool.length];
  },
};

const state = { algorithm: 'round-robin', rps: 20, sent: 0, failed: 0 };

async function dispatch(ip) {
  state.sent++;
  const pool = servers.filter((s) => s.healthy); // balancer only routes to healthy servers
  if (!pool.length) { state.failed++; return { ok: false, server: null }; }
  const res = await handle(algorithms[state.algorithm](pool, ip));
  if (!res.ok) state.failed++;
  return res;
}

/* ---------- Built-in traffic generator ---------- */
const fakeIps = Array.from({ length: 25 }, (_, i) => `192.168.1.${i + 10}`);
let carry = 0;
setInterval(() => {
  carry += state.rps / 10; // runs 10x per second
  while (carry >= 1) { carry--; dispatch(fakeIps[Math.floor(Math.random() * fakeIps.length)]); }
}, 100);

/* ---------- Stats + live push (Server-Sent Events) ---------- */
const clients = new Set();
const snapshot = () => ({
  ...state,
  algorithms: Object.keys(algorithms),
  servers: servers.map(({ id, name, weight, capacity, healthy, active, total, errors, rps, avgLatency, history }) =>
    ({ id, name, weight, capacity, healthy, active, total, errors, rps, avgLatency: Math.round(avgLatency), history })),
});
setInterval(() => {
  servers.forEach((s) => {
    s.rps = s.received - s.lastReceived; s.lastReceived = s.received;
    s.history.push(s.rps); if (s.history.length > 60) s.history.shift();
  });
  const data = `data: ${JSON.stringify(snapshot())}\n\n`;
  clients.forEach((res) => res.write(data));
}, 1000);

/* ---------- HTTP server ---------- */
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
  }
  if (url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res); return req.on('close', () => clients.delete(res));
  }
  // Real entry point: hit http://localhost:3000/app and the balancer picks a fake server
  if (url === '/app') {
    const r = await dispatch(req.socket.remoteAddress || '0.0.0.0');
    return json(res, r.ok ? 200 : 503, r);
  }
  if (req.method === 'POST') {
    const body = await readBody(req);
    if (url === '/api/algorithm' && algorithms[body.algorithm]) { state.algorithm = body.algorithm; return json(res, 200, { ok: true }); }
    if (url === '/api/rps') { state.rps = Math.max(0, Math.min(500, +body.rps || 0)); return json(res, 200, { ok: true }); }
    const m = url.match(/^\/api\/servers\/(\d+)\/toggle$/);
    if (m && servers[+m[1]]) { servers[+m[1]].healthy = !servers[+m[1]].healthy; return json(res, 200, { ok: true }); }
    if (url === '/api/reset') {
      servers.forEach((s) => Object.assign(s, { total: 0, received: 0, errors: 0, lastReceived: 0, rps: 0, avgLatency: 0, current: 0, history: [] }));
      state.sent = 0; state.failed = 0; return json(res, 200, { ok: true });
    }
  }
  json(res, 404, { error: 'not found' });
}).listen(PORT, () => console.log(`Load balancer demo running at http://localhost:${PORT}`));
