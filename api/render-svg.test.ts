import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { FusionPlotSpec } from "@fusionview/core";
import handler from "./render-svg";

const spec: FusionPlotSpec = {
  specVersion: "0.1",
  coordinateSystem: "1-based-inclusive",
  locale: "en",
  fivePrime: {
    gene: { symbol: "A" },
    transcript: { exons: [{ label: "1" }] },
  },
  threePrime: {
    gene: { symbol: "B" },
    transcript: { exons: [{ label: "1" }] },
  },
  fusion: {
    name: "A::B",
    fivePrimeExons: [{ label: "1" }],
    threePrimeExons: [{ label: "1" }],
  },
  chromosomeView: { show: false },
};

describe("Vercel render-svg function", () => {
  let server: Server;
  let endpoint: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      void handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not expose a port.");
    endpoint = `http://127.0.0.1:${address.port}/api/render-svg`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("renders a valid PlotSpec as SVG", async () => {
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

  it("rejects unsupported methods without crashing", async () => {
    const response = await fetch(endpoint);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, OPTIONS");
  });
});
