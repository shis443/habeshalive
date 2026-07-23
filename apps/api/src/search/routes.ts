import type { SearchResults } from "@habeshalive/shared";
import type { FastifyPluginAsync } from "fastify";
import { searchCreators, searchStreams } from "./service.js";

export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req): Promise<SearchResults> => {
    const { q } = req.query as { q?: string };
    const query = q ?? "";
    const [streams, creators] = await Promise.all([searchStreams(query), searchCreators(query)]);
    return { streams, creators };
  });
};
