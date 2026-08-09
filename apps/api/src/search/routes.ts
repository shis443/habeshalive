import type { SearchResults } from "@birq/shared";
import type { FastifyPluginAsync } from "fastify";
import { searchCreators, searchStreams } from "./service.js";

export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: app.tryAuthenticate }, async (req): Promise<SearchResults> => {
    const { q } = req.query as { q?: string };
    const query = q ?? "";
    const [streams, creators] = await Promise.all([
      searchStreams(query, 20, req.user?.sub),
      searchCreators(query),
    ]);
    return { streams, creators };
  });
};
