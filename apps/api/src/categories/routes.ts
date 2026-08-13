import { AppError } from "../common/errors.js";
import { getCategoryBySlug, listCategories } from "./service.js";
import type { FastifyPluginAsync } from "fastify";

// Public reads only — admin CRUD is registered under admin/routes.ts
// (requireAdmin-gated, same pattern as every other admin-managed
// resource), not duplicated here.
export const categoryRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => listCategories());

  app.get<{ Params: { slug: string } }>("/:slug", async (req) => {
    const category = await getCategoryBySlug(req.params.slug);
    if (!category) throw new AppError(404, "Category not found");
    return category;
  });
};
