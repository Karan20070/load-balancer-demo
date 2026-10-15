# Load Balancer Demo

An educational load balancer simulator. A balancer distributes requests across four **fake servers** (different speeds, capacities and weights), and a **live dashboard** shows what each server is doing in real time.

No dependencies. Requires Node.js 18+.

## Run

```bash
git clone https://github.com/<your-username>/load-balancer-demo.git
cd load-balancer-demo
npm start
```

Open http://localhost:3000.

## What you can do

- **Switch algorithms live** and watch the traffic split change.
- **Slide the traffic rate** up to overload the servers and see 503 rejections.
- **Take a server down** and watch the balancer route around it.
- **Send real requests**: `curl http://localhost:3000/app` returns which fake server handled it.

## Algorithms

| Algorithm | How it picks | Good for | Weakness |
|---|---|---|---|
| Round robin | Next server in order | Identical servers | Ignores server size and current load |
| Weighted round robin | Round robin, but bigger servers get more turns | Mixed hardware | Still ignores live load |
| Least connections | Server with fewest active requests | Uneven request durations | Needs connection tracking |
| Random | Uniform random | Simple, stateless | Uneven in short bursts |
| IP hash | Hash of client IP | Sticky sessions | Uneven if few clients dominate |

Servers: `server-1` is big and fast (weight 5), `server-4` is small (weight 1). Try weighted round robin vs plain round robin at high traffic to see why weights matter.

## How it works

```
 traffic generator ─┐
 curl /app ─────────┼─▶ balancer (chosen algorithm) ─▶ fake server 1..4
                    │                                        │
 dashboard ◀── Server-Sent Events (1 snapshot/second) ◀──────┘
```

- `server.js` holds the fake servers, algorithms, traffic generator and HTTP/SSE endpoints.
- `public/index.html` is the dashboard (plain HTML/CSS/JS, canvas chart).
- A fake server waits to simulate work, slows down as it fills, and returns 503 when at capacity or down.

## Simplifications

Real balancers (nginx, HAProxy) use active health checks, retries on failure, connection draining and TLS. Here, "down" is detected instantly and failed requests are not retried. Adding retry/failover is a good exercise.

## Ideas to extend

- Retry a failed request on another server
- Active health checks with failure thresholds
- Least response time algorithm
- Per-server request log panel

## License

MIT
