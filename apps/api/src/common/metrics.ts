import client from "prom-client";
import { pool } from "./db.js";

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [registry],
});

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [registry],
});

// Async collect so scrapes always reflect current DB state without a
// separate poller — prom-client calls this each time /metrics is read.
new client.Gauge({
  name: "streams_live_total",
  help: "Number of currently live streams",
  registers: [registry],
  async collect() {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM streams WHERE status = 'live'`
    );
    this.set(Number(rows[0]?.count ?? 0));
  },
});
