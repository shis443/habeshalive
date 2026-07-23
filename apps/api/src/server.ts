import { buildApp } from "./app.js";
import { env } from "./common/env.js";

const app = buildApp();

app.listen({ port: env.API_PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
