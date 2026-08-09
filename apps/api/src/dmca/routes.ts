import {
  dmcaReportStatusSchema,
  resolveDmcaReportSchema,
  submitCounterNoticeSchema,
  submitDmcaReportSchema,
} from "@habeshalive/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { listDmcaReports, resolveDmcaReport, submitCounterNotice, submitDmcaReport } from "./service.js";

function keyByEmail(req: FastifyRequest): string {
  const body = req.body as { reporterEmail?: unknown } | undefined;
  return typeof body?.reporterEmail === "string" ? `email:${body.reporterEmail}` : req.ip;
}

export const dmcaRoutes: FastifyPluginAsync = async (app) => {
  // Deliberately unauthenticated — a rights holder reporting infringement
  // often has no account here at all. Rate-limited by reporter email
  // (not just IP) for the same reason keyByPhoneNumber/keyByEmail exist in
  // auth/routes.ts: the abuse this guards against (spamming bogus reports
  // to harass a creator) is per-identity, not per-IP.
  app.post(
    "/reports",
    {
      config: {
        rateLimit: { max: 10, timeWindow: "1 hour", hook: "preHandler", skipOnError: false, keyGenerator: keyByEmail },
      },
    },
    async (req, reply) => {
      const input = submitDmcaReportSchema.parse(req.body);
      const result = await submitDmcaReport(input);
      reply.status(201).send(result);
    }
  );

  // requireAdmin (super_admin), not requirePermission("chat:moderate") —
  // this is a legal/compliance action distinct from ordinary content
  // moderation, same reasoning as finance:audit being its own permission
  // rather than folded into chat:moderate.
  app.get("/reports", { preHandler: app.requireAdmin }, async (req) => {
    const status = dmcaReportStatusSchema.optional().parse((req.query as { status?: string }).status);
    return listDmcaReports(status);
  });

  app.post<{ Params: { id: string } }>("/reports/:id/resolve", { preHandler: app.requireAdmin }, async (req, reply) => {
    const input = resolveDmcaReportSchema.parse(req.body);
    await resolveDmcaReport(req.params.id, req.user.sub, input.status, input.resolutionNotes);
    reply.send({ ok: true });
  });

  // The alleged infringer disputing a takedown — authenticated as
  // themselves (respondentUserId comes from req.user.sub in the service,
  // never the body) since a counter-notice's legal weight depends on it
  // actually coming from whoever the takedown silenced.
  app.post<{ Params: { id: string } }>(
    "/reports/:id/counter-notice",
    { preHandler: app.authenticate },
    async (req, reply) => {
      const input = submitCounterNoticeSchema.parse(req.body);
      const result = await submitCounterNotice(req.params.id, req.user.sub, input);
      reply.status(201).send(result);
    }
  );
};
