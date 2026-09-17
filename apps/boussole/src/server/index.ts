import { parseServerAddress } from "@libre-ai/web-platform";
import { createBoussoleHandler } from "./handler";

const { hostname, port } = parseServerAddress(Bun.env);
const fetch = createBoussoleHandler();

const server = Bun.serve({
  fetch,
  hostname,
  port,
});

console.log(`Libre AI Boussole listening on ${server.url.origin}`);
