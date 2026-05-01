import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await buildApp({ config, logger: true });

try {
  await app.listen({ host: config.OPSTAGE_HOST, port: config.OPSTAGE_PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
