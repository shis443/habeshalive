import { adFormatSchema, submitAdLeadSchema, updateCreatorAdsSettingsSchema } from "@habeshalive/shared";
import type { FastifyPluginAsync } from "fastify";
import {
  getAdForStream,
  getCreatorAdsSettings,
  getSponsoredCard,
  recordAdClick,
  submitAdLead,
  updateCreatorAdsSettings,
} from "./service.js";

export const adRoutes: FastifyPluginAsync = async (app) => {
  // Public, unauthenticated — relied on the global 2000/min-per-IP default
  // only (docs/SECURITY.md's "Rate limiting" known-gaps list). A form-spam
  // bot has no identifier to key on besides IP; 5/hour is generous for a
  // real advertiser inquiry but stops a scripted flood.
  app.post(
    "/leads",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour", hook: "preHandler" } } },
    async (req) => {
      const input = submitAdLeadSchema.parse(req.body);
      return submitAdLead(input);
    }
  );

  // Not auth-gated: anonymous viewers see ads too (they just don't get
  // per-viewer frequency capping — see getAdForStream's comment). Uses
  // tryAuthenticate the same way streams/routes.ts's /live does, so a
  // logged-in viewer's subscription still exempts them from ads.
  app.get<{ Querystring: { streamId: string; format: string } }>(
    "/serve",
    { preHandler: app.tryAuthenticate },
    async (req) => {
      const format = adFormatSchema.parse(req.query.format);
      return getAdForStream(req.query.streamId, req.user?.sub ?? null, format);
    }
  );

  // tryAuthenticate added so a logged-in viewer's platform-wide
  // subscription (0025_gursha_gift_economy.sql) exempts them here too —
  // same pattern as /serve above.
  app.get<{ Querystring: { category?: string; language?: string } }>(
    "/sponsored-card",
    { preHandler: app.tryAuthenticate },
    async (req) => getSponsoredCard(req.query.category ?? null, req.query.language ?? null, req.user?.sub ?? null)
  );

  // Same known gap — a real click is a single event per impression, so
  // this stays generous (30/min per IP) purely as a backstop against a
  // scripted click-fraud loop, not a limit a real viewer could hit.
  app.post<{ Params: { impressionId: string } }>(
    "/:impressionId/click",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute", hook: "preHandler" } } },
    async (req) => {
      await recordAdClick(req.params.impressionId);
      return { ok: true };
    }
  );

  app.get("/creator-settings", { preHandler: app.authenticate }, async (req) =>
    getCreatorAdsSettings(req.user.sub)
  );

  app.patch("/creator-settings", { preHandler: app.authenticate }, async (req) => {
    const input = updateCreatorAdsSettingsSchema.parse(req.body);
    return updateCreatorAdsSettings(req.user.sub, input.adsEnabled);
  });
};
