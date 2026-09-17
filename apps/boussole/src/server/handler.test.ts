import { describe, expect, test } from "bun:test";
import { createBoussoleHandler } from "./handler";

const handler = createBoussoleHandler(undefined, () => "req_0000000000000000");

describe("boussole handler", () => {
  test("serves the SSR questionnaire at /", async () => {
    const response = await handler(new Request("https://boussole.test/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Boussole — questionnaire");
    expect(html).toContain("0 / 4 répondu(s).");
  });

  test("reports health as JSON", async () => {
    const response = await handler(new Request("https://boussole.test/api/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: "libre-ai-boussole",
      status: "ok",
      version: "v1",
    });
  });

  test("an unknown route is not found", async () => {
    const response = await handler(new Request("https://boussole.test/nope"));
    expect(response.status).toBe(404);
  });
});
