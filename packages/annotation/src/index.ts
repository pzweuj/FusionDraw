import type {
  AnnotationProvider,
  Assembly,
  ChromosomeAnnotation,
  Cytoband,
  GeneAnnotation,
} from "@fusionview/core";
import { normalizeAssembly, normalizeChromosome } from "@fusionview/core";

export interface AnnotationPackManifest {
  schemaVersion: "0.1";
  assembly: Assembly;
  annotationSource: { name: string; version: string; url?: string; sha256?: string };
  cytobandSource?: { name: string; version?: string; sha256?: string };
  chromosomeLengthSource?: { name: string; sha256?: string };
  coordinateSystem: "1-based-inclusive";
  indexUrl: string;
  shardPattern: string;
  chromosomeCount?: number;
  checksum: string;
  /** Optional per-file checksums for releases that enable runtime integrity checks. */
  shardChecksums?: Record<string, string>;
}

export interface GeneIndexEntry {
  symbol: string;
  id: string;
  shard: string;
  /** Present in compiler-generated packs; optional for old demo fixtures. */
  chromosome?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && Number.isFinite(value) && value >= 1;
}

function isPositiveRange(start: unknown, end: unknown): boolean {
  return isPositiveInteger(start) && isPositiveInteger(end) && start <= end;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isChromosomeString(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    normalizeChromosome(value);
    return true;
  } catch {
    return false;
  }
}

function isSafeRelativePath(value: unknown): value is string {
  return isNonEmptyString(value)
    && !value.startsWith("/")
    && !value.startsWith("\\")
    && !value.startsWith("//")
    && !value.includes("..")
    && !value.includes("\\")
    && !/[?#\u0000-\u001f]/.test(value)
    && !/%(?:2e|2f|5c)/i.test(value)
    && !/^[a-z][a-z0-9+.-]*:/i.test(value);
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isOptionalPositiveInteger(value: unknown): boolean {
  return value === undefined || isPositiveInteger(value);
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value) && value >= 0);
}

function assertManifest(value: unknown): AnnotationPackManifest {
  if (!isRecord(value)) throw new Error("Invalid FusionView annotation manifest.");
  const source = value.annotationSource;
  const checksum = value.checksum;
  if (!isRecord(source)) throw new Error("Invalid FusionView annotation manifest.");
  if (value.schemaVersion !== "0.1"
    || !isNonEmptyString(value.assembly)
    || value.coordinateSystem !== "1-based-inclusive"
    || !isNonEmptyString(value.indexUrl)
    || !isNonEmptyString(value.shardPattern)
    || typeof checksum !== "string"
    || !checksum.trim()
    || !isNonEmptyString(source.name)
    || !isNonEmptyString(source.version)
    || !isOptionalString(source.url)
    || !isOptionalNonEmptyString(source.sha256)) {
    throw new Error("Invalid FusionView annotation manifest.");
  }
  if (source.version.trim().toLowerCase().includes("latest")) throw new Error("Invalid FusionView annotation manifest.");
  let assembly: Assembly;
  try {
    assembly = normalizeAssembly(value.assembly as string);
  } catch {
    throw new Error("Invalid FusionView annotation manifest.");
  }
  if (assembly !== "hg19" && assembly !== "hg38") throw new Error("Invalid FusionView annotation manifest.");
  const indexUrl = value.indexUrl as string;
  const shardPattern = value.shardPattern as string;
  if (!isSafeRelativePath(indexUrl)
    || !isNonEmptyString(shardPattern)
    || (shardPattern.match(/\{shard\}/g) ?? []).length !== 1
    || !isSafeRelativePath(shardPattern.replace("{shard}", "placeholder"))) {
    throw new Error("Invalid FusionView annotation manifest.");
  }
  if (value.cytobandSource !== undefined) {
    if (!isRecord(value.cytobandSource)
      || !isNonEmptyString(value.cytobandSource.name)
      || !isOptionalNonEmptyString(value.cytobandSource.version)
      || !isOptionalNonEmptyString(value.cytobandSource.sha256)) {
      throw new Error("Invalid FusionView annotation manifest.");
    }
    if (typeof value.cytobandSource.version === "string"
      && value.cytobandSource.version.trim().toLowerCase().includes("latest")) {
      throw new Error("Invalid FusionView annotation manifest.");
    }
  }
  if (value.chromosomeLengthSource !== undefined) {
    if (!isRecord(value.chromosomeLengthSource)
      || !isNonEmptyString(value.chromosomeLengthSource.name)
      || !isOptionalNonEmptyString(value.chromosomeLengthSource.sha256)) {
      throw new Error("Invalid FusionView annotation manifest.");
    }
  }
  if (value.chromosomeCount !== undefined && !isOptionalNonNegativeInteger(value.chromosomeCount)) {
    throw new Error("Invalid FusionView annotation manifest.");
  }
  if (value.shardChecksums !== undefined) {
    if (!isRecord(value.shardChecksums)
      || Object.entries(value.shardChecksums).some(([name, digest]) => !isSafeRelativePath(name) || !isNonEmptyString(digest))) {
      throw new Error("Invalid FusionView annotation manifest.");
    }
  }
  return { ...(value as unknown as AnnotationPackManifest), assembly };
}

function assertIndex(value: unknown): GeneIndexEntry[] {
  if (!Array.isArray(value)) throw new Error("Invalid FusionView annotation index.");
  const ids = new Set<string>();
  return value.map((entry) => {
    if (!isRecord(entry)
      || !isNonEmptyString(entry.symbol)
      || !isNonEmptyString(entry.id)
      || !isSafeRelativePath(entry.shard)
      || (entry.chromosome !== undefined && !isChromosomeString(entry.chromosome))
      || ids.has(entry.id as string)) {
      throw new Error("Invalid FusionView annotation index entry.");
    }
    ids.add(entry.id as string);
    return entry as unknown as GeneIndexEntry;
  });
}

function isValidShardExon(value: unknown): boolean {
  if (!isRecord(value)
    || (typeof value.id === "string" && !value.id.trim())
    || !isOptionalString(value.id)
    || !isPositiveRange(value.start, value.end)
    || !isPositiveInteger(value.exonNumber)
    || !isOptionalPositiveInteger(value.cdsStart)
    || !isOptionalPositiveInteger(value.cdsEnd)) return false;
  const start = value.start as number;
  const end = value.end as number;
  const cdsStart = value.cdsStart as number | undefined;
  const cdsEnd = value.cdsEnd as number | undefined;
  if (cdsStart !== undefined && (cdsStart < start || cdsStart > end)) return false;
  if (cdsEnd !== undefined && (cdsEnd < start || cdsEnd > end)) return false;
  if (cdsStart !== undefined && cdsEnd !== undefined && cdsStart > cdsEnd) return false;
  return true;
}

function isValidShardTranscript(value: unknown): boolean {
  if (!isRecord(value)
    || !isNonEmptyString(value.id)
    || !isOptionalString(value.displayName)
    || !isPositiveRange(value.start, value.end)
    || (value.strand !== "+" && value.strand !== "-")
    || !isOptionalString(value.biotype)
    || !isOptionalBoolean(value.canonical)
    || !isOptionalBoolean(value.maneSelect)
    || !isOptionalBoolean(value.manePlusClinical)
    || !isOptionalString(value.appris)
    || !isOptionalBoolean(value.ccds)
    || !isOptionalNonNegativeInteger(value.cdsLength)
    || !Array.isArray(value.exons)
    || !value.exons.every(isValidShardExon)) return false;
  const exons = value.exons as Array<{ start: number; end: number; exonNumber: number }>;
  const seenNumbers = new Set<number>();
  const seenIntervals = new Set<string>();
  for (const exon of exons) {
    if (exon.start < (value.start as number) || exon.end > (value.end as number)) return false;
    if (seenNumbers.has(exon.exonNumber)) return false;
    seenNumbers.add(exon.exonNumber);
    const interval = `${exon.start}:${exon.end}`;
    if (seenIntervals.has(interval)) return false;
    seenIntervals.add(interval);
  }
  const sorted = [...exons].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].start <= sorted[index - 1].end) return false;
  }
  return true;
}

function assertGeneShard(value: unknown): GeneAnnotation[] {
  if (!Array.isArray(value)) throw new Error("Invalid FusionView annotation shard.");
  const geneIds = new Set<string>();
  value.forEach((gene) => {
    if (!isRecord(gene)
      || !isNonEmptyString(gene.id)
      || !isNonEmptyString(gene.symbol)
      || !isOptionalString(gene.displayName)
      || !isChromosomeString(gene.chromosome)
      || !isPositiveRange(gene.start, gene.end)
      || (gene.strand !== "+" && gene.strand !== "-")
      || !Array.isArray(gene.transcripts)
      || geneIds.has(gene.id as string)) {
      throw new Error("Invalid FusionView gene annotation record.");
    }
    const transcriptIds = new Set<string>();
    for (const transcript of gene.transcripts) {
      if (!isValidShardTranscript(transcript) || !isRecord(transcript)
        || transcriptIds.has(transcript.id as string)
        || transcript.strand !== gene.strand
        || (transcript.start as number) < (gene.start as number)
        || (transcript.end as number) > (gene.end as number)) {
        throw new Error("Invalid FusionView gene annotation record.");
      }
      transcriptIds.add(transcript.id as string);
    }
    geneIds.add(gene.id as string);
  });
  return value as GeneAnnotation[];
}

function assertChromosomes(value: unknown): ChromosomeAnnotation[] {
  if (!Array.isArray(value)) throw new Error("Invalid FusionView chromosome annotation.");
  const names = new Set<string>();
  value.forEach((chromosome) => {
    if (!isRecord(chromosome)
      || !isChromosomeString(chromosome.name)
      || !isPositiveInteger(chromosome.length)) {
      throw new Error("Invalid FusionView chromosome record.");
    }
    const normalizedName = normalizeChromosome(chromosome.name as string);
    if (names.has(normalizedName)) throw new Error("Invalid FusionView chromosome record.");
    names.add(normalizedName);
    const length = chromosome.length as number;
    if (chromosome.bands !== undefined) {
      if (!Array.isArray(chromosome.bands)) throw new Error("Invalid FusionView chromosome record.");
      let previousEnd = 0;
      for (const band of chromosome.bands) {
        if (!isRecord(band)
          || !isNonEmptyString(band.name)
          || !isPositiveRange(band.start, band.end)
          || (band.end as number) > length
          || (band.stain !== undefined && typeof band.stain !== "string")
          || (band.start as number) <= previousEnd) {
          throw new Error("Invalid FusionView chromosome record.");
        }
        previousEnd = band.end as number;
      }
    }
  });
  return value as ChromosomeAnnotation[];
}

export class MemoryAnnotationProvider implements AnnotationProvider {
  private readonly genes = new Map<string, GeneAnnotation[]>();
  private readonly chromosomes = new Map<string, ChromosomeAnnotation>();

  constructor(
    records: GeneAnnotation[] = [],
    chromosomes: ChromosomeAnnotation[] = [],
  ) {
    records.forEach((gene) => {
      // Keep malformed records addressable so the resolver can return its
      // structured MALFORMED_GENE_ANNOTATION error instead of the provider
      // constructor throwing before resolution starts.
      const candidate = gene as unknown as Record<string, unknown>;
      const keys = new Set(
        [candidate.symbol, candidate.id]
          .filter((key): key is string => typeof key === "string" && key.trim().length > 0)
          .map((key) => key.trim().toLowerCase()),
      );
      keys.forEach((key) => {
        const existing = this.genes.get(key) ?? [];
        existing.push(gene);
        this.genes.set(key, existing);
      });
    });
    chromosomes.forEach((chr) => {
      try {
        const name = normalizeChromosome((chr as unknown as { name: string }).name);
        this.chromosomes.set(name, { ...chr, name });
      } catch {
        // Invalid chromosome records are ignored here; callers that need
        // strict pack integrity use StaticAnnotationProvider's shard checks.
      }
    });
  }

  getGene(_assembly: Assembly, query: { symbol?: string; id?: string; chromosome?: string }): GeneAnnotation | undefined {
    if (!query || typeof query !== "object") return undefined;
    const rawKey = query.id ?? query.symbol;
    if (typeof rawKey !== "string" || !rawKey.trim()) return undefined;
    const key = rawKey.trim().toLowerCase();
    const records = this.genes.get(key) ?? [];
    if (!query.chromosome) return records[0];
    const chromosome = normalizeChromosome(query.chromosome);
    return records.find((gene) => {
      try {
        return normalizeChromosome(gene.chromosome) === chromosome;
      } catch {
        // Return malformed records for the resolver to diagnose rather than
        // hiding them as an ordinary gene-not-found result.
        return true;
      }
    });
  }

  getChromosome(_assembly: Assembly, chromosome: string): ChromosomeAnnotation | undefined {
    return this.chromosomes.get(normalizeChromosome(chromosome));
  }

  getCytoband(assembly: Assembly, chromosome: string, position: number): string | undefined {
    return this.getChromosome(assembly, chromosome)?.bands?.find((band) => position >= band.start && position <= band.end)?.name;
  }
}

/** Static pack provider. It fetches only the index and the shard containing a requested gene. */
export class StaticAnnotationProvider implements AnnotationProvider {
  private manifest?: AnnotationPackManifest;
  private manifestPromise?: Promise<AnnotationPackManifest>;
  private index = new Map<string, GeneIndexEntry[]>();
  private readonly cache = new Map<string, GeneAnnotation>();
  private readonly shardPromises = new Map<string, Promise<GeneAnnotation[]>>();
  private readonly chromosomeCache = new Map<string, ChromosomeAnnotation>();
  private chromosomePromise?: Promise<void>;
  // A response returned from Cache.match is tracked so loaders can evict and
  // retry malformed cached JSON without retrying malformed network payloads.
  private readonly cachedResponses = new WeakSet<object>();
  private readonly baseUrl: string;
  private cacheName = "fusionview-annotation-v0.1-bootstrap";

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private markCached<T extends object>(response: T): T {
    this.cachedResponses.add(response);
    return response;
  }

  private isCached(response: unknown): response is object {
    return typeof response === "object" && response !== null && this.cachedResponses.has(response);
  }

  private async request(url: string, options: { manifest?: boolean; checksum?: string; label?: string; bypassCache?: boolean } = {}): Promise<Response> {
    // The manifest is the cache version authority. Always revalidate it so a
    // newly published pack can select a new content-addressed cache namespace.
    if (options.manifest) {
      if (typeof caches === "undefined") return fetch(url, { cache: "no-store" });
      let manifestStore: Cache;
      try {
        const opened = await caches.open("fusionview-annotation-manifests-v0.1");
        if (!opened) return fetch(url, { cache: "no-store" });
        manifestStore = opened;
      } catch {
        // Cache API failures must not make a static pack unusable. The
        // network request remains the source of truth for this call.
        return fetch(url, { cache: "no-store" });
      }
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (response.ok) {
          try { await manifestStore.put(url, response.clone()); } catch { /* Cache API is an optimization. */ }
        }
        if (response.ok) return response;
        let cached: Response | undefined;
        try { cached = manifestStore && typeof manifestStore.match === "function" ? await manifestStore.match(url) : undefined; } catch { cached = undefined; }
        return cached ? this.markCached(cached) : response;
      } catch (error) {
        let cached: Response | undefined;
        try { cached = manifestStore && typeof manifestStore.match === "function" ? await manifestStore.match(url) : undefined; } catch { cached = undefined; }
        if (cached) return this.markCached(cached);
        throw error;
      }
    }
    if (typeof caches === "undefined") {
      const response = await fetch(url, { cache: "no-cache" });
      if (response.ok) await this.verifyChecksum(response, options.checksum, options.label ?? url);
      return response;
    }
    let store: Cache;
    try {
      const opened = await caches.open(this.cacheName);
      if (!opened) {
        const response = await fetch(url, { cache: "no-cache" });
        if (response.ok) await this.verifyChecksum(response, options.checksum, options.label ?? url);
        return response;
      }
      store = opened;
    } catch {
      const response = await fetch(url, { cache: "no-cache" });
      if (response.ok) await this.verifyChecksum(response, options.checksum, options.label ?? url);
      return response;
    }
    if (options.bypassCache) {
      const response = await fetch(url, { cache: "no-cache" });
      if (response.ok) {
        await this.verifyChecksum(response, options.checksum, options.label ?? url);
        try { await store.put(url, response.clone()); } catch { /* Cache API is an optimization. */ }
      }
      return response;
    }
    let cached: Response | undefined;
    try { cached = store && typeof store.match === "function" ? await store.match(url) : undefined; } catch { cached = undefined; }
    if (cached && cached.ok !== false) {
      this.markCached(cached);
      try {
        await this.verifyChecksum(cached, options.checksum, options.label ?? url);
        return cached;
      } catch {
        // A stale/corrupt cached shard is recoverable when the network is
        // available. Remove it and continue with a verified fresh response.
        try { if (typeof store.delete === "function") await store.delete(url); } catch { /* best effort */ }
      }
    } else if (cached) {
      // A cached 404/500 is not a usable annotation record. Evict it before
      // trying the network so a transient failure cannot permanently mask a
      // later pack publication.
      try { if (typeof store.delete === "function") await store.delete(url); } catch { /* best effort */ }
    }
    const response = await fetch(url, { cache: "no-cache" });
    if (response.ok) {
      await this.verifyChecksum(response, options.checksum, options.label ?? url);
      try { await store.put(url, response.clone()); } catch { /* Cache API is an optimization. */ }
    }
    return response;
  }

  private async deleteCached(url: string): Promise<void> {
    if (typeof caches === "undefined") return;
    try {
      const store = await caches.open(this.cacheName);
      if (store && typeof store.delete === "function") await store.delete(url);
    } catch {
      // Cache invalidation is an optimization; callers still receive the
      // validation error that identified the malformed shard.
    }
  }

  private async deleteManifestCached(url: string): Promise<void> {
    if (typeof caches === "undefined") return;
    try {
      const store = await caches.open("fusionview-annotation-manifests-v0.1");
      if (store && typeof store.delete === "function") await store.delete(url);
    } catch {
      // Manifest invalidation is best effort; the parse/fetch error remains
      // the authoritative diagnostic for the caller.
    }
  }

  private async verifyChecksum(response: Response, expected: string | undefined, label: string): Promise<void> {
    if (!expected) return;
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof response.clone !== "function") {
      throw new Error(`Unable to verify annotation checksum for ${label}.`);
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await response.clone().arrayBuffer();
    } catch (error) {
      throw new Error(`Unable to verify annotation checksum for ${label}: ${String(error)}`);
    }
    const digest = await subtle.digest("SHA-256", bytes);
    const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (actual.toLowerCase() !== expected.trim().toLowerCase()) {
      throw new Error(`Annotation checksum mismatch for ${label}.`);
    }
  }

  async loadManifest(): Promise<AnnotationPackManifest> {
    if (this.manifest) return this.manifest;
    if (this.manifestPromise) return this.manifestPromise;
    const pending = (async () => {
      const manifestUrl = `${this.baseUrl}/manifest.json`;
      let response = await this.request(manifestUrl, { manifest: true });
      if (!response.ok) throw new Error(`Unable to load annotation manifest (${response.status}).`);
      let manifest: AnnotationPackManifest;
      try {
        manifest = assertManifest(await response.json());
      } catch (error) {
        if (!this.isCached(response)) {
          await this.deleteManifestCached(manifestUrl);
          throw error;
        }
        // A malformed cached manifest must not pin the provider to a broken
        // pack. Evict it and make one direct network attempt.
        await this.deleteManifestCached(manifestUrl);
        response = await fetch(manifestUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`Unable to load annotation manifest (${response.status}).`);
        try {
          manifest = assertManifest(await response.json());
        } catch (freshError) {
          await this.deleteManifestCached(manifestUrl);
          throw freshError;
        }
      }
      const version = manifest.checksum;
      const safeVersion = version.replace(/[^a-zA-Z0-9._-]/g, "_");
      const safeAssembly = String(manifest.assembly).replace(/[^a-zA-Z0-9._-]/g, "_");
      this.cacheName = `fusionview-annotation-v0.1-${safeAssembly}-${safeVersion}`;

      const indexUrl = `${this.baseUrl}/${manifest.indexUrl}`;
      const indexResponse = await this.request(indexUrl);
      if (!indexResponse.ok) throw new Error(`Unable to load annotation index (${indexResponse.status}).`);
      let entries: GeneIndexEntry[];
      try {
        entries = assertIndex(await indexResponse.json());
      } catch (error) {
        if (!this.isCached(indexResponse)) {
          await this.deleteCached(indexUrl);
          throw error;
        }
        // A malformed cached index should not poison every subsequent lookup.
        // Evict it and make one direct network attempt before surfacing the
        // integrity error.
        await this.deleteCached(indexUrl);
        const fresh = await this.request(indexUrl, { bypassCache: true });
        if (!fresh.ok) throw new Error(`Unable to load annotation index (${fresh.status}).`);
        try {
          entries = assertIndex(await fresh.json());
        } catch (freshError) {
          await this.deleteCached(indexUrl);
          throw freshError;
        }
      }
      this.index.clear();
      entries.forEach((entry) => {
        [entry.symbol, entry.id].forEach((key) => {
          const normalized = key.trim().toLowerCase();
          const existing = this.index.get(normalized) ?? [];
          existing.push(entry);
          this.index.set(normalized, existing);
        });
      });
      this.manifest = manifest;
      return manifest;
    })();
    this.manifestPromise = pending;
    try {
      return await pending;
    } catch (error) {
      this.manifestPromise = undefined;
      throw error;
    }
  }

  async getMetadata(assembly: Assembly): Promise<{ source?: string; annotationVersion?: string; checksum?: string }> {
    const requestedAssembly = normalizeAssembly(assembly);
    const manifest = await this.loadManifest();
    if (manifest.assembly !== requestedAssembly) throw new Error(`Annotation pack is ${manifest.assembly}, requested ${requestedAssembly}.`);
    return {
      source: manifest.annotationSource.url || manifest.annotationSource.name,
      annotationVersion: manifest.annotationSource.version,
      checksum: manifest.checksum,
    };
  }

  private async loadShard(manifest: AnnotationPackManifest, entry: GeneIndexEntry): Promise<GeneAnnotation[]> {
    const existing = this.shardPromises.get(entry.shard);
    if (existing) return existing;
    const url = `${this.baseUrl}/${manifest.shardPattern.replace("{shard}", entry.shard)}`;
    const pending = (async () => {
      const requestOptions = {
        checksum: manifest.shardChecksums?.[entry.shard],
        label: entry.shard,
      };
      const response = await this.request(url, requestOptions);
      if (!response.ok) throw new Error(`Unable to load annotation shard ${entry.shard} (${response.status}).`);
      try {
        return assertGeneShard(await response.json());
      } catch (error) {
        if (this.isCached(response)) {
          // The cached body was malformed even if its checksum matched. Evict
          // it and retry once from the network; a second malformed response is
          // returned to the caller and never cached.
          await this.deleteCached(url);
          const fresh = await this.request(url, { ...requestOptions, bypassCache: true });
          if (!fresh.ok) throw new Error(`Unable to load annotation shard ${entry.shard} (${fresh.status}).`);
          try {
            return assertGeneShard(await fresh.json());
          } catch (freshError) {
            await this.deleteCached(url);
            throw freshError;
          }
        }
        await this.deleteCached(url);
        throw error;
      }
    })();
    this.shardPromises.set(entry.shard, pending);
    try {
      const records = await pending;
      records.forEach((gene) => this.cache.set(gene.id, gene));
      return records;
    } finally {
      if (this.shardPromises.get(entry.shard) === pending) this.shardPromises.delete(entry.shard);
    }
  }

  async getGene(assembly: Assembly, query: { symbol?: string; id?: string; chromosome?: string }): Promise<GeneAnnotation | undefined> {
    const requestedAssembly = normalizeAssembly(assembly);
    const manifest = await this.loadManifest();
    if (manifest.assembly !== requestedAssembly) throw new Error(`Annotation pack is ${manifest.assembly}, requested ${requestedAssembly}.`);
    if (!query || typeof query !== "object") return undefined;
    const rawKey = query.id ?? query.symbol;
    if (typeof rawKey !== "string" || !rawKey.trim()) return undefined;
    const key = rawKey.trim().toLowerCase();
    const entries = this.index.get(key) ?? [];
    const requestedChromosome = query.chromosome ? normalizeChromosome(query.chromosome) : undefined;
    const candidates = entries.filter((candidate) => !requestedChromosome
      || !candidate.chromosome
      || normalizeChromosome(candidate.chromosome) === requestedChromosome);
    for (const entry of candidates) {
      const cached = this.cache.get(entry.id);
      if (cached && (!requestedChromosome || normalizeChromosome(cached.chromosome) === requestedChromosome)) return cached;
      const shard = await this.loadShard(manifest, entry);
      const gene = this.cache.get(entry.id);
      if (gene && (!requestedChromosome || normalizeChromosome(gene.chromosome) === requestedChromosome)) return gene;
    }
    return undefined;
  }

  async getChromosome(assembly: Assembly, chromosome: string): Promise<ChromosomeAnnotation | undefined> {
    const requestedAssembly = normalizeAssembly(assembly);
    const manifest = await this.loadManifest();
    if (manifest.assembly !== requestedAssembly) throw new Error(`Annotation pack is ${manifest.assembly}, requested ${requestedAssembly}.`);
    const name = normalizeChromosome(chromosome);
    if (this.chromosomeCache.has(name)) return this.chromosomeCache.get(name);
    if (!this.chromosomePromise) {
      this.chromosomePromise = (async () => {
        const url = `${this.baseUrl}/chromosomes.json`;
        const response = await this.request(url);
        if (!response.ok) return;
        let records: ChromosomeAnnotation[];
        try {
          records = assertChromosomes(await response.json());
        } catch (error) {
          if (!this.isCached(response)) {
            await this.deleteCached(url);
            throw error;
          }
          await this.deleteCached(url);
          const fresh = await this.request(url, { bypassCache: true });
          if (!fresh.ok) throw new Error(`Unable to load chromosome annotation (${fresh.status}).`);
          try {
            records = assertChromosomes(await fresh.json());
          } catch (freshError) {
            await this.deleteCached(url);
            throw freshError;
          }
        }
        records.forEach((chr) => {
          const normalized = normalizeChromosome(chr.name);
          this.chromosomeCache.set(normalized, { ...chr, name: normalized });
        });
      })();
    }
    try {
      await this.chromosomePromise;
    } finally {
      this.chromosomePromise = undefined;
    }
    return this.chromosomeCache.get(name);
  }

  async getCytoband(assembly: Assembly, chromosome: string, position: number): Promise<string | undefined> {
    return (await this.getChromosome(assembly, chromosome))?.bands?.find((band: Cytoband) => position >= band.start && position <= band.end)?.name;
  }
}

export function createAnnotationProvider(records: GeneAnnotation[], chromosomes: ChromosomeAnnotation[] = []): MemoryAnnotationProvider {
  return new MemoryAnnotationProvider(records, chromosomes);
}
