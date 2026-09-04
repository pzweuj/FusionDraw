import { describe, expect, it } from "vitest";
import { applyPlotExonEdit, normalizeAssembly, normalizeBreakpoint, normalizeChromosome, parsePlotSpec, resolveFusion, serializePlotSpec, validatePlotSpec } from "./index.js";
import type { GeneAnnotation } from "./types.js";

const gene: GeneAnnotation = {
  id: "gene-1", symbol: "TEST", chromosome: "chr1", start: 100, end: 1000, strand: "+",
  transcripts: [
    { id: "tx-long", start: 100, end: 1000, strand: "+", canonical: true, cdsLength: 1000, exons: [
      { id: "e1", start: 100, end: 200, exonNumber: 1, cdsStart: 120, cdsEnd: 180 },
      { id: "e2", start: 500, end: 600, exonNumber: 2, cdsStart: 520, cdsEnd: 580 },
    ] },
  ],
};

describe("core normalization and resolver", () => {
  it("normalizes chromosome spellings", () => {
    expect(normalizeChromosome("19")).toBe("chr19");
    expect(normalizeChromosome("CHRMT")).toBe("chrM");
    expect(normalizeAssembly("GRCh37")).toBe("hg19");
    expect(normalizeAssembly("GRCh37.p13")).toBe("hg19");
    expect(normalizeAssembly("GRCh38.p14")).toBe("hg38");
    expect(normalizeAssembly("hg19.p13")).toBe("hg19");
    expect(normalizeAssembly(" hg38 ")).toBe("hg38");
    expect(() => normalizeBreakpoint({ chromosome: "1", position: 0 })).toThrow();
    expect(() => normalizeBreakpoint({ chromosome: "", position: 1 })).toThrow();
    expect(() => normalizeBreakpoint({ chromosome: "1", position: 1, coordinateSystem: "0-based-half-open" as never })).toThrow();
  });

  it("rejects a top-level input coordinate system other than 1-based inclusive", async () => {
    const provider = { getGene: () => gene };
    const result = await resolveFusion({
      assembly: "hg38",
      coordinateSystem: "0-based-half-open" as never,
      fivePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 150 } },
      threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } },
    }, provider);
    expect(result.errors[0]?.code).toBe("INVALID_COORDINATE_SYSTEM");
    expect(result.errors[0]).not.toHaveProperty("partner");
    expect(result.data).toBeUndefined();
  });

  it("reports a nested coordinate-system error using the same resolver contract", async () => {
    const provider = { getGene: () => gene };
    const result = await resolveFusion({
      assembly: "hg38",
      fivePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 150, coordinateSystem: "0-based-half-open" as never } },
      threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } },
    }, provider);
    expect(result.errors.some((item) => item.code === "INVALID_COORDINATE_SYSTEM" && item.partner === "fivePrime")).toBe(true);
    expect(result.data).toBeUndefined();
  });

  it("resolves both partners and marks an intron breakpoint", async () => {
    const provider = { getGene: () => gene, getChromosome: () => ({ name: "chr1", length: 2000 }) };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "TEST", breakpoint: { chromosome: "1", position: 300 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    expect(result.errors).toHaveLength(0);
    expect(result.data?.fivePrime.resolution?.region).toBe("intron");
    expect(result.data?.fusion.name).toBe("TEST::TEST");
  });

  it("copies pinned annotation metadata into PlotSpec provenance", async () => {
    const provider = {
      getGene: () => gene,
      getMetadata: () => ({ source: "GENCODE", annotationVersion: "v49", checksum: "pack-sha" }),
    };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 300 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    expect(result.data?.provenance).toEqual({ source: "GENCODE", annotationVersion: "v49", annotationChecksum: "pack-sha" });
  });

  it("can resolve with a provider that omits optional chromosome metadata", async () => {
    const provider = { getGene: () => gene };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 300 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((item) => item.code === "CHROMOSOME_ANNOTATION_UNAVAILABLE")).toBe(false);
    expect(result.data?.fivePrime.chromosomeLength).toBeUndefined();
  });

  it("derives cytoband from chromosome metadata when provider omits getCytoband", async () => {
    const provider = { getGene: () => gene, getChromosome: () => ({ name: "chr1", length: 2000, bands: [{ name: "p11", start: 1, end: 400 }] }) };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 300 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    expect(result.data?.fivePrime.cytoband).toBe("p11");
  });

  it("returns a structured chromosome mismatch error", async () => {
    const provider = { getGene: () => gene, getChromosome: () => ({ name: "chr1", length: 2000 }) };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "TEST", breakpoint: { chromosome: "chr2", position: 300 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    expect(result.errors.some((item) => item.code === "CHROMOSOME_MISMATCH")).toBe(true);
    expect(result.data).toBeUndefined();
  });

  it("reports chromosome mismatch even when the provider filters loci", async () => {
    const provider = {
      getGene: (_assembly: string, query: { chromosome?: string }) => query.chromosome === "chr2" ? undefined : gene,
      getChromosome: () => ({ name: "chr1", length: 2000 }),
    };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "TEST", breakpoint: { chromosome: "chr2", position: 300 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    expect(result.errors.some((item) => item.code === "CHROMOSOME_MISMATCH")).toBe(true);
    expect(result.data).toBeUndefined();
  });

  it("preserves an assembly mismatch as a distinct resolver error", async () => {
    const provider = { getGene: () => { throw new Error("Annotation pack is hg38, requested hg19."); } };
    const result = await resolveFusion({ assembly: "hg19", fivePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 150 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    expect(result.errors.some((item) => item.code === "ASSEMBLY_MISMATCH")).toBe(true);
    expect(result.data).toBeUndefined();
  });

  it("returns a structured gene-span error for a breakpoint outside the gene", async () => {
    const provider = { getGene: () => gene, getChromosome: () => ({ name: "chr1", length: 2000 }) };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 50 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    expect(result.errors.some((item) => item.code === "BREAKPOINT_OUTSIDE_GENE")).toBe(true);
    expect(result.data).toBeUndefined();
  });

  it("keeps the resolver error contract for missing partner input", async () => {
    const provider = { getGene: () => gene, getChromosome: () => ({ name: "chr1", length: 2000 }) };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: undefined as never, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    expect(result.errors.some((item) => item.code === "INVALID_PARTNER")).toBe(true);
    expect(result.data).toBeUndefined();
  });

  it("does not produce data from malformed annotation records", async () => {
    const brokenGene = { id: "g", symbol: "BROKEN", chromosome: "chr1", start: 1, end: 100, strand: "+", transcripts: [{ id: "tx", start: 1, end: 100, strand: "+", exons: [{ start: 10, end: 20, exonNumber: 1, cdsStart: 30, cdsEnd: 15 }] }] } as unknown as GeneAnnotation;
    const provider = {
      getGene: () => brokenGene,
      getChromosome: () => ({ name: "chr1", length: 2000 }),
    };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "BROKEN", breakpoint: { chromosome: "chr1", position: 15 } }, threePrime: { gene: "BROKEN", breakpoint: { chromosome: "chr1", position: 15 } } }, provider);
    expect(result.errors.some((item) => item.code === "MALFORMED_GENE_ANNOTATION")).toBe(true);
    expect(result.data).toBeUndefined();
  });

  it("reports malformed transcript structure without leaking partial data", async () => {
    const malformed = {
      ...gene,
      symbol: "BAD_STRUCTURE",
      transcripts: [{ ...gene.transcripts[0], id: "tx-bad", exons: [
        { id: "e1", start: 100, end: 250, exonNumber: 1 },
        { id: "e1-overlap", start: 200, end: 300, exonNumber: 2 },
      ] }],
    } as GeneAnnotation;
    const provider = {
      getGene: (_assembly: string, query: { symbol?: string }) => query.symbol === "BAD_STRUCTURE" ? malformed : gene,
      getChromosome: () => ({ name: "chr1", length: 2000 }),
    };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "BAD_STRUCTURE", breakpoint: { chromosome: "chr1", position: 150 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    expect(result.errors.some((item) => item.code === "MALFORMED_TRANSCRIPT_ANNOTATION")).toBe(true);
    expect(result.data).toBeUndefined();
  });

  it("rejects assembly-out-of-range breakpoints without returning data", async () => {
    const provider = { getGene: () => gene, getChromosome: () => ({ name: "chr1", length: 200 }) };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 500 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 150 } } }, provider);
    expect(result.errors.some((item) => item.code === "ASSEMBLY_OUT_OF_RANGE")).toBe(true);
    expect(result.data).toBeUndefined();
  });

  it("reports assembly range before a chromosome-filtered provider returns no gene", async () => {
    const provider = {
      getGene: () => undefined,
      getChromosome: () => ({ name: "chr1", length: 200 }),
    };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 500 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 150 } } }, provider);
    expect(result.errors.some((item) => item.code === "ASSEMBLY_OUT_OF_RANGE")).toBe(true);
    expect(result.data).toBeUndefined();
  });

  it("does not silently replace an explicitly selected transcript", async () => {
    const provider = { getGene: () => gene, getChromosome: () => ({ name: "chr1", length: 2000 }) };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "TEST", transcriptId: "missing", breakpoint: { chromosome: "chr1", position: 150 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    expect(result.errors.some((item) => item.code === "TRANSCRIPT_NOT_FOUND")).toBe(true);
    expect(result.data).toBeUndefined();
  });

  it("ranks only breakpoint-compatible transcripts", async () => {
    const rankedGene: GeneAnnotation = {
      ...gene,
      symbol: "RANKED",
      transcripts: [
        { ...gene.transcripts[0], id: "mane-outside", start: 1, end: 50, maneSelect: true },
        { ...gene.transcripts[0], id: "canonical-compatible", canonical: true, maneSelect: false },
        { ...gene.transcripts[0], id: "stable-compatible", canonical: false, maneSelect: false },
      ],
    };
    const provider = {
      getGene: (_assembly: string, query: { symbol?: string }) => query.symbol === "RANKED" ? rankedGene : gene,
      getChromosome: () => ({ name: "chr1", length: 2000 }),
    };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "RANKED", breakpoint: { chromosome: "chr1", position: 150 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    expect(result.data?.fivePrime.transcript.id).toBe("canonical-compatible");
  });

  it("recognizes only principal APPRIS tags during ranking", async () => {
    const apprisGene: GeneAnnotation = {
      ...gene,
      symbol: "APPRIS",
      transcripts: [
        { ...gene.transcripts[0], id: "candidate-long", canonical: false, cdsLength: 9999, appris: "appris_candidate" },
        { ...gene.transcripts[0], id: "principal", canonical: false, cdsLength: 1, appris: "appris_principal_1" },
      ],
    };
    const provider = {
      getGene: (_assembly: string, query: { symbol?: string }) => query.symbol === "APPRIS" ? apprisGene : gene,
      getChromosome: () => ({ name: "chr1", length: 2000 }),
    };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "APPRIS", breakpoint: { chromosome: "chr1", position: 150 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    expect(result.data?.fivePrime.transcript.id).toBe("principal");
  });

  it("recognizes compact APPRIS principal spellings", async () => {
    const apprisGene: GeneAnnotation = {
      ...gene,
      symbol: "APPRIS_COMPACT",
      transcripts: [
        { ...gene.transcripts[0], id: "candidate", canonical: false, cdsLength: 9999, appris: "appris_candidate" },
        { ...gene.transcripts[0], id: "principal-compact", canonical: false, cdsLength: 1, appris: "principal1" },
      ],
    };
    const provider = {
      getGene: (_assembly: string, query: { symbol?: string }) => query.symbol === "APPRIS_COMPACT" ? apprisGene : gene,
      getChromosome: () => ({ name: "chr1", length: 2000 }),
    };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "APPRIS_COMPACT", breakpoint: { chromosome: "chr1", position: 150 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    expect(result.data?.fivePrime.transcript.id).toBe("principal-compact");
  });

  it("derives CDS length for deterministic ranking when metadata omits cdsLength", async () => {
    const derivedGene: GeneAnnotation = {
      ...gene,
      symbol: "DERIVED_CDS",
      transcripts: [
        { ...gene.transcripts[0], id: "short-cds", canonical: false, cdsLength: undefined, exons: [{ id: "short", start: 100, end: 200, exonNumber: 1, cdsStart: 150, cdsEnd: 160 }] },
        { ...gene.transcripts[0], id: "long-cds", canonical: false, cdsLength: undefined, exons: [{ id: "long", start: 100, end: 200, exonNumber: 1, cdsStart: 110, cdsEnd: 190 }] },
      ],
    };
    const provider = {
      getGene: (_assembly: string, query: { symbol?: string }) => query.symbol === "DERIVED_CDS" ? derivedGene : gene,
      getChromosome: () => ({ name: "chr1", length: 2000 }),
    };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "DERIVED_CDS", breakpoint: { chromosome: "chr1", position: 150 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    expect(result.data?.fivePrime.transcript.id).toBe("long-cds");
  });

  it("clips an exon when the breakpoint is inside it", async () => {
    const provider = { getGene: () => gene, getChromosome: () => ({ name: "chr1", length: 2000 }) };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 150 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    expect(result.data?.fivePrime.resolution?.region).toBe("exon");
    expect(result.data?.fusion.fivePrimeExons[0].genomicEnd).toBe(150);
    expect(result.data?.fusion.fivePrimeExons[0].breakpoint).toBe(true);
    expect(result.data?.fivePrime.resolution?.exonOffset).toBe(51);
  });

  it("does not overlap partial 5′ and 3′ exon segments at a shared breakpoint", async () => {
    const sharedGene: GeneAnnotation = {
      ...gene,
      symbol: "SHARED",
      transcripts: [{ ...gene.transcripts[0], id: "tx-shared", exons: [{ id: "shared", start: 100, end: 200, exonNumber: 1 }] }],
    };
    const provider = {
      getGene: (_assembly: string, query: { symbol?: string }) => query.symbol === "SHARED" ? sharedGene : gene,
      getChromosome: () => ({ name: "chr1", length: 2000 }),
    };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "SHARED", breakpoint: { chromosome: "chr1", position: 150 } }, threePrime: { gene: "SHARED", breakpoint: { chromosome: "chr1", position: 150 } } }, provider);
    expect(result.errors).toHaveLength(0);
    expect(result.data?.fusion.fivePrimeExons[0]).toMatchObject({ genomicStart: 100, genomicEnd: 150 });
    expect(result.data?.fusion.threePrimeExons[0]).toMatchObject({ genomicStart: 151, genomicEnd: 200 });
  });

  it("distinguishes UTR, CDS, and intronic breakpoint regions", async () => {
    const provider = { getGene: () => gene, getChromosome: () => ({ name: "chr1", length: 2000 }) };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 110 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    expect(result.data?.fivePrime.resolution?.codingRegion).toBe("utr");
    expect(result.data?.threePrime.resolution?.codingRegion).toBe("cds");
    expect(result.data?.fivePrime.resolution?.region).toBe("exon");
  });

  it("classifies an exon with one CDS boundary as UTR or CDS", async () => {
    const partialCds: GeneAnnotation = {
      ...gene,
      symbol: "PARTIAL_CDS",
      transcripts: [{ ...gene.transcripts[0], id: "tx-partial", exons: [{ start: 100, end: 200, exonNumber: 1, cdsStart: 150 }] }],
    };
    const provider = {
      getGene: (_assembly: string, query: { symbol?: string }) => query.symbol === "PARTIAL_CDS" ? partialCds : gene,
      getChromosome: () => ({ name: "chr1", length: 2000 }),
    };
    const utr = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "PARTIAL_CDS", breakpoint: { chromosome: "chr1", position: 120 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    const cds = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "PARTIAL_CDS", breakpoint: { chromosome: "chr1", position: 180 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    expect(utr.data?.fivePrime.resolution?.codingRegion).toBe("utr");
    expect(cds.data?.fivePrime.resolution?.codingRegion).toBe("cds");
  });

  it("uses transcript-direction intron numbers and retained exons on the minus strand", async () => {
    const minusGene: GeneAnnotation = {
      id: "gene-minus", symbol: "MINUS", chromosome: "chr2", start: 100, end: 1000, strand: "-",
      transcripts: [{ id: "tx-minus", start: 100, end: 1000, strand: "-", exons: [
        { id: "m3", start: 100, end: 200, exonNumber: 3 },
        { id: "m2", start: 500, end: 600, exonNumber: 2 },
        { id: "m1", start: 900, end: 1000, exonNumber: 1 },
      ] }],
    };
    const provider = {
      getGene: (_assembly: string, query: { symbol?: string }) => query.symbol === "MINUS" ? minusGene : gene,
      getChromosome: (_assembly: string, chromosome: string) => ({ name: chromosome, length: 2000 }),
    };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "MINUS", breakpoint: { chromosome: "chr2", position: 550 } }, threePrime: { gene: "MINUS", breakpoint: { chromosome: "chr2", position: 950 } } }, provider);
    expect(result.errors).toHaveLength(0);
    expect(result.data?.fivePrime.resolution?.region).toBe("exon");
    expect(result.data?.fivePrime.resolution?.exonNumber).toBe(2);
    expect(result.data?.fusion.fivePrimeExons.at(-1)?.genomicStart).toBe(550);
    expect(result.data?.fusion.fivePrimeExons.at(-1)?.genomicEnd).toBe(600);
    expect(result.data?.fusion.threePrimeExons[0].genomicStart).toBe(900);
    // A breakpoint is a 1-based inclusive base retained by the 5' segment;
    // the 3' segment starts at the next transcript-direction base.  This
    // keeps the two partial exon segments disjoint on the minus strand too.
    expect(result.data?.fusion.threePrimeExons[0].genomicEnd).toBe(949);
    const intronic = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "MINUS", breakpoint: { chromosome: "chr2", position: 300 } }, threePrime: { gene: "MINUS", breakpoint: { chromosome: "chr2", position: 950 } } }, provider);
    expect(intronic.data?.fivePrime.resolution?.intronNumber).toBe(2);
  });

  it("clips a minus-strand shared exon in transcript direction without overlap", async () => {
    const minusGene: GeneAnnotation = {
      id: "gene-minus-shared", symbol: "MINUS_SHARED", chromosome: "chr2", start: 100, end: 200, strand: "-",
      transcripts: [{ id: "tx-minus-shared", start: 100, end: 200, strand: "-", exons: [{ id: "m1", start: 100, end: 200, exonNumber: 1 }] }],
    };
    const provider = {
      getGene: (_assembly: string, query: { symbol?: string }) => query.symbol === "MINUS_SHARED" ? minusGene : gene,
      getChromosome: (_assembly: string, chromosome: string) => ({ name: chromosome, length: 2000 }),
    };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "MINUS_SHARED", breakpoint: { chromosome: "chr2", position: 150 } }, threePrime: { gene: "MINUS_SHARED", breakpoint: { chromosome: "chr2", position: 150 } } }, provider);
    expect(result.errors).toHaveLength(0);
    expect(result.data?.fusion.fivePrimeExons[0]).toMatchObject({ genomicStart: 150, genomicEnd: 200 });
    expect(result.data?.fusion.threePrimeExons[0]).toMatchObject({ genomicStart: 100, genomicEnd: 149 });
  });

  it("rejects an input strand that disagrees with the selected transcript", async () => {
    const provider = { getGene: () => gene, getChromosome: () => ({ name: "chr1", length: 2000 }) };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "TEST", strand: "-", breakpoint: { chromosome: "chr1", position: 150 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    expect(result.errors.some((item) => item.code === "STRAND_MISMATCH")).toBe(true);
    expect(result.data).toBeUndefined();
  });

  it("skips a malformed sibling transcript but resolves a valid compatible one", async () => {
    const malformedSibling: GeneAnnotation = {
      ...gene,
      symbol: "MIXED",
      transcripts: [
        { ...gene.transcripts[0], id: "bad-span", start: 1, end: 50, maneSelect: true },
        { ...gene.transcripts[0], id: "good", maneSelect: false, canonical: true },
      ],
    };
    const provider = {
      getGene: (_assembly: string, query: { symbol?: string }) => query.symbol === "MIXED" ? malformedSibling : gene,
      getChromosome: () => ({ name: "chr1", length: 2000 }),
    };
    const result = await resolveFusion({ assembly: "hg38", fivePrime: { gene: "MIXED", breakpoint: { chromosome: "chr1", position: 150 } }, threePrime: { gene: "TEST", breakpoint: { chromosome: "chr1", position: 550 } } }, provider);
    expect(result.errors).toHaveLength(0);
    expect(result.data?.fivePrime.transcript.id).toBe("good");
  });

  it("round-trips a coordinate-free manual PlotSpec", () => {
    const manual = {
      specVersion: "0.1" as const, coordinateSystem: "1-based-inclusive" as const, locale: "en" as const,
      fivePrime: { gene: { symbol: "A" }, transcript: { exons: [{ label: "1" }] } },
      threePrime: { gene: { symbol: "B" }, transcript: { exons: [{ label: "2", width: 40 }] } },
      fusion: { name: "A::B", fivePrimeExons: [{ label: "1", biological: { genomicStart: 10, genomicEnd: 20 }, visual: { label: "A1", width: 36 } }], threePrimeExons: [{ label: "2", width: 40 }] },
      provenance: { source: "GENCODE", annotationVersion: "v49", annotationChecksum: "pack-sha" },
    };
    expect(parsePlotSpec(serializePlotSpec(manual))).toEqual(manual);
  });

  it("returns structured validation errors for malformed imported JSON", () => {
    expect(() => parsePlotSpec("{not-json")).toThrow("Invalid PlotSpec JSON");
    expect(() => validatePlotSpec({
      specVersion: "0.1", coordinateSystem: "1-based-inclusive", locale: "en",
      fivePrime: { gene: { symbol: "A" }, transcript: { exons: [{ label: 1 }] } },
      threePrime: { gene: { symbol: "B" }, transcript: { exons: [] } },
      fusion: { name: "A::B", fivePrimeExons: [], threePrimeExons: [] },
    })).not.toThrow();
    expect(validatePlotSpec({
      specVersion: "0.1", coordinateSystem: "1-based-inclusive", locale: "en",
      fivePrime: { gene: { symbol: "A" }, transcript: { exons: [{ label: 1 }] } },
      threePrime: { gene: { symbol: "B" }, transcript: { exons: [] } },
      fusion: { name: "A::B", fivePrimeExons: [], threePrimeExons: [] },
    }).some((item) => item.includes("label must be a string"))).toBe(true);
    expect(validatePlotSpec({
      specVersion: "0.1", coordinateSystem: "1-based-inclusive", locale: "en",
      fivePrime: { gene: { symbol: "A" }, transcript: { exons: [{ label: "1", biological: { genomicStart: 20 }, visual: { width: -1 } }] } },
      threePrime: { gene: { symbol: "B" }, transcript: { exons: [{ label: "1" }] } },
      fusion: { name: "A::B", fivePrimeExons: [{ label: "1" }], threePrimeExons: [{ label: "1" }] },
    }).length).toBeGreaterThan(0);
    expect(validatePlotSpec({
      specVersion: "0.1", coordinateSystem: "1-based-inclusive", locale: "en",
      fivePrime: { gene: { symbol: "A" }, transcript: { exons: [{ label: "1" }] } },
      threePrime: { gene: { symbol: "B" }, transcript: { exons: [{ label: "1" }] } },
      fusion: { name: "A::B", fivePrimeExons: [{ label: "1", visible: false }], threePrimeExons: [{ label: "1", visual: { visible: false } }] },
    }).some((item) => item.includes("visible exon"))).toBe(true);
    expect(validatePlotSpec({
      specVersion: "0.1", coordinateSystem: "1-based-inclusive", locale: "en",
      fivePrime: { gene: { symbol: "A" }, chromosome: "chr1", breakpoint: 101, chromosomeLength: 100, transcript: { exons: [{ label: "1" }] } },
      threePrime: { gene: { symbol: "B" }, transcript: { exons: [{ label: "1" }] } },
      fusion: { name: "A::B", fivePrimeExons: [{ label: "1" }], threePrimeExons: [{ label: "1" }] },
    }).some((item) => item.includes("must not exceed chromosomeLength"))).toBe(true);
    expect(validatePlotSpec({
      specVersion: "0.1", coordinateSystem: "1-based-inclusive", locale: "en",
      fivePrime: { gene: { symbol: "A" }, chromosomeLength: 100, transcript: { exons: [{ label: "1", genomicStart: 90, genomicEnd: 101 }] } },
      threePrime: { gene: { symbol: "B" }, transcript: { exons: [{ label: "1" }] } },
      fusion: { name: "A::B", fivePrimeExons: [{ label: "1", genomicStart: 90, genomicEnd: 101 }], threePrimeExons: [{ label: "1" }] },
    }).filter((item) => item.includes("genomicEnd must not exceed chromosomeLength")).length).toBeGreaterThan(0);
    expect(validatePlotSpec({
      specVersion: "0.1", coordinateSystem: "1-based-inclusive", locale: "en",
      fivePrime: { gene: { symbol: "A" }, chromosome: "chr1", breakpoint: 10, transcript: { exons: [{ label: "1" }] }, resolution: { transcriptId: "tx", chromosome: "chr1", position: 11, strand: "+", region: "exon", codingRegion: "unknown", exonNumber: 1 } },
      threePrime: { gene: { symbol: "B" }, transcript: { exons: [{ label: "1" }] } },
      fusion: { name: "A::B", fivePrimeExons: [{ label: "1" }], threePrimeExons: [{ label: "1" }] },
    }).some((item) => item.includes("resolution.position must match breakpoint"))).toBe(true);
    expect(validatePlotSpec({
      specVersion: "0.1", coordinateSystem: "1-based-inclusive", locale: "en",
      fivePrime: { gene: { symbol: "A" }, transcript: { exons: [{ label: "1", id: "   " }] } },
      threePrime: { gene: { symbol: "B" }, transcript: { exons: [{ label: "1" }] } },
      fusion: { name: "A::B", fivePrimeExons: [{ label: "1" }], threePrimeExons: [{ label: "1" }] },
    }).some((item) => item.includes("id must be a non-empty string"))).toBe(true);
    expect(validatePlotSpec({
      specVersion: "0.1", coordinateSystem: "1-based-inclusive", locale: "en",
      fivePrime: {
        gene: { symbol: "A" }, breakpoint: 150, strand: "+",
        transcript: { id: "tx-a", exons: [{ label: "1", genomicStart: 100, genomicEnd: 200 }] },
        resolution: { transcriptId: "tx-b", chromosome: "chr1", position: 150, strand: "+", region: "exon", codingRegion: "unknown", exonNumber: 1, exonOffset: 51 },
      },
      threePrime: { gene: { symbol: "B" }, transcript: { exons: [{ label: "1" }] } },
      fusion: { name: "A::B", fivePrimeExons: [{ label: "1" }], threePrimeExons: [{ label: "1" }] },
    }).some((item) => item.includes("resolution.transcriptId must match transcript.id"))).toBe(true);
  });

  it("keeps editor coordinate overrides complete and allows coordinate-free clearing", () => {
    const source = { label: "1", genomicStart: 100, genomicEnd: 200, width: 30 };
    const changedStart = applyPlotExonEdit(source, "biological", { genomicStart: 120 });
    expect(changedStart.biological).toMatchObject({ genomicStart: 120, genomicEnd: 200 });
    expect(changedStart.genomicStart).toBe(100);
    expect(changedStart.genomicEnd).toBe(200);
    expect(source).toEqual({ label: "1", genomicStart: 100, genomicEnd: 200, width: 30 });
    expect(validatePlotSpec({
      specVersion: "0.1", coordinateSystem: "1-based-inclusive", locale: "en",
      fivePrime: { gene: { symbol: "A" }, transcript: { exons: [{ label: "1" }] } },
      threePrime: { gene: { symbol: "B" }, transcript: { exons: [{ label: "1" }] } },
      fusion: { name: "A::B", fivePrimeExons: [changedStart], threePrimeExons: [{ label: "1" }] },
    })).toHaveLength(0);
    const coordinateFree = applyPlotExonEdit(changedStart, "biological", { genomicStart: undefined });
    expect(coordinateFree.genomicStart).toBeUndefined();
    expect(coordinateFree.genomicEnd).toBeUndefined();
    expect(coordinateFree.biological?.genomicStart).toBeUndefined();
    expect(coordinateFree.biological?.genomicEnd).toBeUndefined();
    expect(coordinateFree).not.toHaveProperty("biological");
    const visualCleared = applyPlotExonEdit(
      applyPlotExonEdit(source, "visual", { label: "custom", width: 60, visible: false }),
      "visual",
      { label: undefined, width: undefined, visible: undefined },
    );
    expect(visualCleared).not.toHaveProperty("visual");
  });
});
