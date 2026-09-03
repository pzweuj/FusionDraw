import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { FusionPlotSpec } from "@fusionview/core";
import { createRenderSvgMiddleware } from "./api-handler";
import { RENDER_SVG_API_PATH } from "./api-contract";

const partner = (symbol: string) => ({
  gene: { symbol },
  transcript: { exons: [{ label: "1" }] },
});

const spec: FusionPlotSpec = {
  specVersion: "0.1",
  coordinateSystem: "1-based-inclusive",
  locale: "en",
  fivePrime: partner("A"),
  threePrime: partner("B"),
  fusion: {
    name: "A::B",
    fivePrimeExons: [{ label: "1" }],
    threePrimeExons: [{ label: "1" }],
  },
  chromosomeView: { show: false },
};

describe("PlotSpec SVG API", () => {
  let server: Server;
  let endpoint: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      void createRenderSvgMiddleware()(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not expose a port.");
    endpoint = `http://127.0.0.1:${address.port}${RENDER_SVG_API_PATH}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("returns SVG for a valid PlotSpec POST", async () => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(spec),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.text()).toContain('id="fusion-transcript"');
  });

  it("returns a useful client error for an invalid PlotSpec", async () => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.json()).error).toContain("Invalid PlotSpec");
  });

  it("supports CORS preflight and rejects unsupported methods", async () => {
    const preflight = await fetch(endpoint, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);

    const get = await fetch(endpoint);
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST, OPTIONS");
  });
});
