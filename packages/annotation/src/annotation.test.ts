import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { MemoryAnnotationProvider, StaticAnnotationProvider } from "./index";
import type { GeneAnnotation } from "@fusionview/core";

afterEach(() => vi.unstubAllGlobals());

describe("annotation provider", () => {
  it("normalizes chromosome records and resolves cytobands", () => {
    const provider = new MemoryAnnotationProvider([], [{ name: "19", length: 1000, bands: [{ name: "q21", start: 501, end: 900 }] }]);
    expect(provider.getChromosome("hg38", "chr19")?.name).toBe("chr19");
    expect(provider.getCytoband("hg38", "19", 600)).toBe("q21");
  });

  it("resolves duplicate symbols by chromosome when provided", () => {
    const makeGene = (id: string, chromosome: string): GeneAnnotation => ({
      id, symbol: "DUP", chromosome, start: 100, end: 200, strand: "+", transcripts: [],
    });
    const provider = new MemoryAnnotationProvider([makeGene("g1", "chr1"), makeGene("g2", "chr2")]);
    expect(provider.getGene("hg38", { symbol: "DUP", chromosome: "2" })?.id).toBe("g2");
  });

  it("keeps malformed gene records addressable for resolver diagnostics", () => {
    const malformed = { id: "broken", symbol: "BROKEN", chromosome: "chr1", start: 1, end: 10, strand: "+", transcripts: "not-an-array" } as unknown as GeneAnnotation;
    const provider = new MemoryAnnotationProvider([malformed]);
    expect(provider.getGene("hg38", { symbol: "BROKEN", chromosome: "chr1" })).toBe(malformed);
  });

  it("rejects a malformed static annotation shard", async () => {
    const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body, clone: () => response(body) });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("manifest.json")) return response({ schemaVersion: "0.1", assembly: "hg38", coordinateSystem: "1-based-inclusive", indexUrl: "index.json", shardPattern: "{shard}", checksum: "fixture", annotationSource: { name: "fixture", version: "1" } });
      if (url.endsWith("index.json")) return response([{ symbol: "BAD", id: "g1", shard: "bad.json" }]);
      return response({ not: "an array" });
    }));
    const provider = new StaticAnnotationProvider("/annotation/hg38");
    await expect(provider.getGene("hg38", { symbol: "BAD", chromosome: "chr1" })).rejects.toThrow("Invalid FusionView annotation shard");
  });

  it("rejects an unversioned annotation manifest", async () => {
    const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body, clone: () => response(body) });
    vi.stubGlobal("fetch", vi.fn(async () => response({ schemaVersion: "0.1", assembly: "hg38", coordinateSystem: "1-based-inclusive", indexUrl: "index.json", shardPattern: "{shard}", annotationSource: { name: "fixture", version: "latest" } })));
    await expect(new StaticAnnotationProvider("/annotation/hg38").loadManifest()).rejects.toThrow("Invalid FusionView annotation manifest");
  });

  it("rejects a floating cytoband version in an otherwise pinned manifest", async () => {
    const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body, clone: () => response(body) });
    vi.stubGlobal("fetch", vi.fn(async () => response({
      schemaVersion: "0.1", assembly: "hg38", coordinateSystem: "1-based-inclusive",
      indexUrl: "index.json", shardPattern: "{shard}", checksum: "fixture",
      annotationSource: { name: "GENCODE", version: "v49" },
      cytobandSource: { name: "UCSC", version: "latest" },
    })));
    await expect(new StaticAnnotationProvider("/annotation/hg38").loadManifest()).rejects.toThrow("Invalid FusionView annotation manifest");
  });

  it("rejects annotation manifests that escape the same-origin pack", async () => {
    const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body, clone: () => response(body) });
    vi.stubGlobal("fetch", vi.fn(async () => response({ schemaVersion: "0.1", assembly: "hg38", coordinateSystem: "1-based-inclusive", indexUrl: "https://example.invalid/index.json", shardPattern: "{shard}", checksum: "fixture", annotationSource: { name: "fixture", version: "1" } })));
    await expect(new StaticAnnotationProvider("/annotation/hg38").loadManifest()).rejects.toThrow("Invalid FusionView annotation manifest");
  });

  it("evicts a malformed cached manifest and retries the network payload", async () => {
    const cachedManifest = new Response(JSON.stringify({ schemaVersion: "0.1", assembly: "hg38", coordinateSystem: "1-based-inclusive", indexUrl: "../index.json", shardPattern: "{shard}", checksum: "fixture", annotationSource: { name: "fixture", version: "1" } }));
    const store = {
      match: vi.fn(async (url: string) => url.endsWith("manifest.json") ? cachedManifest : undefined),
      delete: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    };
    vi.stubGlobal("caches", { open: vi.fn(async () => store) });
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      if (!url.endsWith("manifest.json")) return new Response(JSON.stringify([]));
      return new Response(JSON.stringify({
        schemaVersion: "0.1", assembly: "hg38", coordinateSystem: "1-based-inclusive",
        indexUrl: "index.json", shardPattern: "{shard}", checksum: "fixture",
        annotationSource: { name: "fixture", version: "1" },
      }));
    }));
    await expect(new StaticAnnotationProvider("/annotation/hg38").loadManifest()).resolves.toMatchObject({ assembly: "hg38" });
    expect(store.delete).toHaveBeenCalled();
  });

  it("names the shard cache with the manifest checksum", async () => {
    const cacheNames: string[] = [];
    const store = { match: vi.fn(async () => undefined), put: vi.fn(async () => undefined) };
    vi.stubGlobal("caches", { open: vi.fn(async (name: string) => { cacheNames.push(name); return store; }) });
    const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body, clone: () => response(body) });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("manifest.json")) return response({ schemaVersion: "0.1", assembly: "hg38", coordinateSystem: "1-based-inclusive", indexUrl: "index.json", shardPattern: "{shard}", checksum: "abc123", annotationSource: { name: "fixture", version: "1" } });
      return response([]);
    }));
    await new StaticAnnotationProvider("/annotation/hg38").loadManifest();
    expect(cacheNames).toContain("fusionview-annotation-v0.1-hg38-abc123");
  });

  it("exposes pinned manifest metadata", async () => {
    const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body, clone: () => response(body) });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("manifest.json")) return response({ schemaVersion: "0.1", assembly: "hg38", coordinateSystem: "1-based-inclusive", indexUrl: "index.json", shardPattern: "{shard}", checksum: "pack-sha", annotationSource: { name: "GENCODE", version: "v49", url: "https://gencode.example/v49" } });
      return response([]);
    }));
    await expect(new StaticAnnotationProvider("/annotation/hg38").getMetadata("hg38")).resolves.toEqual({ source: "https://gencode.example/v49", annotationVersion: "v49", checksum: "pack-sha" });
  });

  it("verifies an optional shard checksum before accepting annotation data", async () => {
    const body = JSON.stringify([{ id: "g1", symbol: "CHECK", chromosome: "chr1", start: 1, end: 10, strand: "+", transcripts: [] }]);
    const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    const checksum = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("manifest.json")) return new Response(JSON.stringify({ schemaVersion: "0.1", assembly: "hg38", coordinateSystem: "1-based-inclusive", indexUrl: "index.json", shardPattern: "{shard}", checksum: "fixture", shardChecksums: { "g.json": checksum }, annotationSource: { name: "fixture", version: "1" } }));
      if (url.endsWith("index.json")) return new Response(JSON.stringify([{ symbol: "CHECK", id: "g1", shard: "g.json", chromosome: "chr1" }]));
      return new Response(body);
    }));
    const provider = new StaticAnnotationProvider("/annotation/hg38");
    await expect(provider.getGene("hg38", { symbol: "CHECK", chromosome: "chr1" })).resolves.toMatchObject({ id: "g1" });
  });

  it("evicts a bad cached shard and recovers from a verified network response", async () => {
    const goodBody = JSON.stringify([{ id: "g1", symbol: "RECOVER", chromosome: "chr1", start: 1, end: 10, strand: "+", transcripts: [] }]);
    const badBody = JSON.stringify([{ id: "g1", symbol: "RECOVER", chromosome: "chr1", start: 1, end: 10, strand: "-", transcripts: [] }]);
    const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(goodBody));
    const checksum = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const cachedShard = new Response(badBody);
    const store = {
      match: vi.fn(async (url: string) => url.endsWith("g.json") ? cachedShard : undefined),
      delete: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    };
    vi.stubGlobal("caches", { open: vi.fn(async () => store) });
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("manifest.json")) return new Response(JSON.stringify({ schemaVersion: "0.1", assembly: "hg38", coordinateSystem: "1-based-inclusive", indexUrl: "index.json", shardPattern: "{shard}", checksum: "fixture", shardChecksums: { "g.json": checksum }, annotationSource: { name: "fixture", version: "1" } }));
      if (url.endsWith("index.json")) return new Response(JSON.stringify([{ symbol: "RECOVER", id: "g1", shard: "g.json", chromosome: "chr1" }]));
      return new Response(goodBody);
    }));
    const provider = new StaticAnnotationProvider("/annotation/hg38");
    await expect(provider.getGene("hg38", { symbol: "RECOVER", chromosome: "chr1" })).resolves.toMatchObject({ id: "g1" });
    expect(store.delete).toHaveBeenCalled();
    expect(store.put).toHaveBeenCalled();
  });

  it("evicts a malformed cached shard and retries the network payload", async () => {
    const goodBody = JSON.stringify([{ id: "g1", symbol: "MALFORMED_CACHE", chromosome: "chr1", start: 1, end: 10, strand: "+", transcripts: [] }]);
    const cachedShard = new Response(JSON.stringify({ genes: "not-an-array" }));
    const store = {
      match: vi.fn(async (url: string) => url.endsWith("g.json") ? cachedShard : undefined),
      delete: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    };
    vi.stubGlobal("caches", { open: vi.fn(async () => store) });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("manifest.json")) return new Response(JSON.stringify({ schemaVersion: "0.1", assembly: "hg38", coordinateSystem: "1-based-inclusive", indexUrl: "index.json", shardPattern: "{shard}", checksum: "fixture", annotationSource: { name: "fixture", version: "1" } }));
      if (url.endsWith("index.json")) return new Response(JSON.stringify([{ symbol: "MALFORMED_CACHE", id: "g1", shard: "g.json", chromosome: "chr1" }]));
      return new Response(goodBody);
    }));
    const provider = new StaticAnnotationProvider("/annotation/hg38");
    await expect(provider.getGene("hg38", { symbol: "MALFORMED_CACHE", chromosome: "chr1" })).resolves.toMatchObject({ id: "g1" });
    expect(store.delete).toHaveBeenCalled();
    expect(store.put).toHaveBeenCalled();
  });

  it("evicts a malformed cached index and retries it from the network", async () => {
    const cachedIndex = new Response(JSON.stringify({ entries: "not-an-array" }));
    const store = {
      match: vi.fn(async (url: string) => url.endsWith("index.json") ? cachedIndex : undefined),
      delete: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    };
    vi.stubGlobal("caches", { open: vi.fn(async () => store) });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("manifest.json")) return new Response(JSON.stringify({ schemaVersion: "0.1", assembly: "hg38", coordinateSystem: "1-based-inclusive", indexUrl: "index.json", shardPattern: "{shard}", checksum: "fixture", annotationSource: { name: "fixture", version: "1" } }));
      return new Response(JSON.stringify([]));
    }));
    const provider = new StaticAnnotationProvider("/annotation/hg38");
    await expect(provider.loadManifest()).resolves.toMatchObject({ assembly: "hg38" });
    expect(store.delete).toHaveBeenCalled();
  });

  it("does not reuse a cached non-OK response for a shard", async () => {
    const body = JSON.stringify([{ id: "g1", symbol: "RETRY_STATUS", chromosome: "chr1", start: 1, end: 10, strand: "+", transcripts: [] }]);
    const cachedShard = new Response("not found", { status: 404 });
    const store = {
      match: vi.fn(async (url: string) => url.endsWith("g.json") ? cachedShard : undefined),
      delete: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    };
    vi.stubGlobal("caches", { open: vi.fn(async () => store) });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("manifest.json")) return new Response(JSON.stringify({ schemaVersion: "0.1", assembly: "hg38", coordinateSystem: "1-based-inclusive", indexUrl: "index.json", shardPattern: "{shard}", checksum: "fixture", annotationSource: { name: "fixture", version: "1" } }));
      if (url.endsWith("index.json")) return new Response(JSON.stringify([{ symbol: "RETRY_STATUS", id: "g1", shard: "g.json", chromosome: "chr1" }]));
      return new Response(body);
    }));
    const provider = new StaticAnnotationProvider("/annotation/hg38");
    await expect(provider.getGene("hg38", { symbol: "RETRY_STATUS", chromosome: "chr1" })).resolves.toMatchObject({ id: "g1" });
    expect(store.delete).toHaveBeenCalled();
  });
});
