import { join } from "node:path";
import { createRequestHandler, renderSsrDocument, type StaticAsset } from "@libre-ai/web-platform";
import { boussoleDocument } from "../shared/document";

export function createBoussoleHandler(
  distRoot = join(import.meta.dir, "../../dist"),
  requestId = () => `req_${crypto.randomUUID().replaceAll("-", "")}`,
) {
  const asset = (path: string, contentType: string): StaticAsset => ({
    body: Bun.file(join(distRoot, path)),
    cacheControl: "public, max-age=300",
    contentType,
  });
  const assets: Record<string, StaticAsset> = {
    "/assets/app.js": asset("assets/app.js", "text/javascript; charset=utf-8"),
    "/assets/tokens.css": asset("assets/tokens.css", "text/css; charset=utf-8"),
    "/assets/styles.css": asset("assets/styles.css", "text/css; charset=utf-8"),
    "/assets/icon.svg": asset("assets/icon.svg", "image/svg+xml"),
    "/manifest.webmanifest": {
      body: Bun.file(join(distRoot, "manifest.webmanifest")),
      contentType: "application/manifest+json",
    },
    "/sw.js": {
      body: Bun.file(join(distRoot, "sw.js")),
      contentType: "text/javascript; charset=utf-8",
    },
  };
  return createRequestHandler({
    assets,
    requestId,
    routes: {
      "/": () => renderSsrDocument(boussoleDocument()),
      "/api/health": () =>
        Response.json({
          service: "libre-ai-boussole",
          status: "ok",
          version: "v1",
        }),
    },
  });
}
