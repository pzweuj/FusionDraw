import { describe, expect, it } from "vitest";
import { renderFusionSvg } from "./index.js";
import type { FusionPlotSpec } from "@fusionview/core";
import { layoutFusion } from "@fusionview/layout";

const partner = (symbol: string) => ({ gene: { symbol }, transcript: { exons: [{ label: "1", width: 30 }, { label: "2", width: 45 }] } });
const spec: FusionPlotSpec = { specVersion: "0.1", coordinateSystem: "1-based-inclusive", locale: "en", fivePrime: partner("A"), threePrime: partner("B"), fusion: { name: "A::B", fivePrimeExons: [{ label: "1" }], threePrimeExons: [{ label: "2" }] }, chromosomeView: { show: false } };

describe("SVG renderer", () => {
  it("renders stable layer ids and standard SVG only", () => {
    const svg = renderFusionSvg(spec);
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain('id="fusion-transcript"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(svg).toContain("A::B");
    expect(svg).not.toContain("foreignObject");
    expect(layoutFusion(spec).layers.map((layer) => layer.id)).toEqual([
      "chromosomes", "chromosome-connectors", "source-genes", "fusion-connectors", "fusion-transcript",
    ]);
  });

  it("links chromosome breakpoints to source gene tracks with an opening brace", () => {
    const withChromosomes: FusionPlotSpec = {
      ...spec,
      fivePrime: { ...spec.fivePrime, chromosome: "chr1", breakpoint: 50, chromosomeLength: 100 },
      threePrime: { ...spec.threePrime, chromosome: "chr2", breakpoint: 75, chromosomeLength: 100 },
      chromosomeView: { show: true },
    };
    const connectors = layoutFusion(withChromosomes).layers.find((layer) => layer.id === "chromosome-connectors");
    const braces = connectors?.elements.filter((element) => element.attrs["data-brace"] === "true") ?? [];
    expect(braces).toHaveLength(2);
    expect(braces.every((element) => element.tag === "path")).toBe(true);
  });

  it("renders the gene locus at the ideogram breakpoint and only the transcript id below the gene", () => {
    const withLocus: FusionPlotSpec = {
      ...spec,
      fivePrime: { ...spec.fivePrime, chromosome: "chr1", breakpoint: 50, chromosomeLength: 100, cytoband: "p21", transcript: { id: "ENST1", exons: [{ label: "1", width: 30 }, { label: "2", width: 45 }] } },
      chromosomeView: { show: true },
    };
    const model = layoutFusion(withLocus);
    const chromosomes = model.layers.find((layer) => layer.id === "chromosomes")?.elements ?? [];
    const locus = chromosomes.find((element) => element.attrs["data-locus"] === "true");
    expect(locus?.text).toBe("p21");
    // The locus is anchored at the breakpoint x on the ideogram.
    const fraction = (50 - 1) / 99;
    expect(Number(locus!.attrs.x)).toBeCloseTo(110 + fraction * 390, 5);
    // The gene track shows the transcript id but NOT the chromosome.
    const source = model.layers.find((layer) => layer.id === "source-genes")?.elements ?? [];
    const geneTexts = source.filter((element) => element.tag === "text").map((element) => element.text);
    expect(geneTexts).toContain("ENST1");
    expect(geneTexts.some((text) => typeof text === "string" && text.includes("chr1"))).toBe(false);
  });

  it("falls back to the breakpoint coordinate when the locus has no cytoband", () => {
    const withCoord: FusionPlotSpec = {
      ...spec,
      fivePrime: { ...spec.fivePrime, chromosome: "chr1", breakpoint: 50, chromosomeLength: 100 },
      chromosomeView: { show: true },
    };
    const model = layoutFusion(withCoord);
    const locus = model.layers.find((layer) => layer.id === "chromosomes")?.elements?.find((element) => element.attrs["data-locus"] === "true");
    expect(locus?.text).toBe("50");
  });

  it("renders cytoband labels when a band has enough visual width", () => {
    const withBands: FusionPlotSpec = {
      ...spec,
      fivePrime: { ...spec.fivePrime, chromosome: "chr1", breakpoint: 50, chromosomeLength: 100, chromosomeBands: [{ name: "p11", start: 1, end: 70, stain: "gneg" }] },
      chromosomeView: { show: true },
    };
    expect(renderFusionSvg(withBands)).toContain(">p11</text>");
  });

  it("renders visual overrides without changing biological coordinates", () => {
    const edited: FusionPlotSpec = {
      ...spec,
      fusion: {
        ...spec.fusion,
        fivePrimeExons: [{ label: "1", genomicStart: 10, genomicEnd: 20, visual: { label: "custom", width: 120 } }],
      },
    };
    const svg = renderFusionSvg(edited);
    expect(svg).toContain("custom");
    expect(svg).toContain('data-exon="custom"');
    expect(svg).not.toContain("foreignObject");
  });

  it("no longer renders the clinical disclaimer in the drawing area", () => {
    const svg = renderFusionSvg({ ...spec, locale: "zh-CN" });
    expect(svg).not.toContain("科研示意图");
    expect(svg).toContain("FusionDraw 融合图");
  });

  it("draws dashed breakpoint connectors from source genes down to the fusion transcript", () => {
    const withBreakpoints: FusionPlotSpec = {
      ...spec,
      fivePrime: {
        ...spec.fivePrime,
        chromosome: "chr1",
        breakpoint: 50,
        chromosomeLength: 100,
        resolution: { transcriptId: "tx", chromosome: "chr1", position: 50, strand: "+", region: "exon", codingRegion: "unknown", exonNumber: 1 },
      },
      threePrime: {
        ...spec.threePrime,
        chromosome: "chr2",
        breakpoint: 75,
        chromosomeLength: 100,
        resolution: { transcriptId: "tx2", chromosome: "chr2", position: 75, strand: "+", region: "exon", codingRegion: "unknown", exonNumber: 1 },
      },
      chromosomeView: { show: true },
    };
    const connectors = layoutFusion(withBreakpoints).layers.find((layer) => layer.id === "fusion-connectors")?.elements ?? [];
    const lines = connectors.filter((element) => element.tag === "line" && element.attrs["data-connector"] === "breakpoint");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.attrs["stroke-dasharray"]).toBeDefined();
  });

  it("draws retained-range dashed connectors from each source gene to its fusion exons", () => {
    const model = layoutFusion(spec);
    const connectors = model.layers.find((layer) => layer.id === "fusion-connectors")?.elements ?? [];
    const ranges = connectors.filter((element) => element.tag === "line" && element.attrs["data-connector"] === "range");
    expect(ranges).toHaveLength(2);
    for (const line of ranges) expect(line.attrs["stroke-dasharray"]).toBeDefined();

    const sourceRects = (model.layers.find((layer) => layer.id === "source-genes")?.elements ?? []).filter((element) => element.tag === "rect");
    const fusionRects = (model.layers.find((layer) => layer.id === "fusion-transcript")?.elements ?? []).filter((element) => element.tag === "rect");
    const center = (rect: { attrs: Record<string, string | number | undefined> }) => Number(rect.attrs.x) + Number(rect.attrs.width) / 2;

    // 5′ partner: its first retained exon points to the upper-left corner of
    // the first fused exon.
    expect(Number(ranges[0].attrs.x1)).toBeCloseTo(center(sourceRects[0]), 5);
    expect(Number(ranges[0].attrs.x2)).toBeCloseTo(Number(fusionRects[0].attrs.x), 5);
    // 3′ partner: its last retained exon points to the upper-right corner of
    // the last fused exon.
    expect(Number(ranges[1].attrs.x1)).toBeCloseTo(center(sourceRects[sourceRects.length - 1]), 5);
    expect(Number(ranges[1].attrs.x2)).toBeCloseTo(Number(fusionRects[fusionRects.length - 1].attrs.x) + Number(fusionRects[fusionRects.length - 1].attrs.width), 5);
  });

  it("keeps a negative-strand 3′ partner's breakpoint on the exon 5′ edge and its range at the 3′ exon side", () => {
    const negativeThreePrime: FusionPlotSpec = {
      ...spec,
      threePrime: {
        ...spec.threePrime,
        strand: "-",
        manual: true,
        transcript: { exons: [{ label: "3", width: 30 }, { label: "2", width: 30 }, { label: "1", width: 30 }] },
        breakpoint: 100,
        resolution: { transcriptId: "tx2", chromosome: "chr2", position: 100, strand: "-", region: "exon", codingRegion: "unknown", exonNumber: 2 },
      },
      fusion: { ...spec.fusion, threePrimeExons: [{ label: "2", width: 30 }, { label: "3", width: 30 }] },
    };
    const model = layoutFusion(negativeThreePrime);
    const source = model.layers.find((layer) => layer.id === "source-genes")?.elements ?? [];
    const threeRects = source.filter((element) => element.tag === "rect" && Number(element.attrs.x) >= 600);
    expect(threeRects.map((element) => element.attrs["data-exon"])).toEqual(["3", "2", "1"]);
    const breakpoint = (model.layers.find((layer) => layer.id === "fusion-connectors")?.elements ?? [])
      .find((element) => element.attrs["data-connector"] === "breakpoint");
    const exon2 = threeRects[1];
    expect(Number(breakpoint!.attrs.x1)).toBe(Number(exon2.attrs.x) + Number(exon2.attrs.width));
    const range = (model.layers.find((layer) => layer.id === "fusion-connectors")?.elements ?? [])
      .filter((element) => element.attrs["data-connector"] === "range")[1];
    const fusionRects = (model.layers.find((layer) => layer.id === "fusion-transcript")?.elements ?? []).filter((element) => element.tag === "rect");
    const target = fusionRects[fusionRects.length - 1];
    expect(Number(range.attrs.x2)).toBe(Number(target.attrs.x) + Number(target.attrs.width));
  });

  it("keeps the fused segments close around the junction", () => {
    const model = layoutFusion(spec);
    const fusionRects = (model.layers.find((layer) => layer.id === "fusion-transcript")?.elements ?? []).filter((element) => element.tag === "rect");
    const five = fusionRects[0];
    const three = fusionRects[fusionRects.length - 1];
    const gap = Number(three.attrs.x) - (Number(five.attrs.x) + Number(five.attrs.width));
    expect(gap).toBe(0);
  });

  it("joins breakpoint exons directly and omits the middle dashed line for exon boundary mode", () => {
    const boundary: FusionPlotSpec = {
      ...spec,
      fivePrime: { ...spec.fivePrime, resolution: { transcriptId: "tx", chromosome: "chr1", position: 100, strand: "+", region: "exon", codingRegion: "unknown", exonNumber: 1 } },
      threePrime: { ...spec.threePrime, resolution: { transcriptId: "tx2", chromosome: "chr2", position: 200, strand: "+", region: "exon", codingRegion: "unknown", exonNumber: 2 } },
    };
    const model = layoutFusion(boundary);
    const fusion = model.layers.find((layer) => layer.id === "fusion-transcript")?.elements ?? [];
    const rects = fusion.filter((element) => element.tag === "rect");
    const gap = Number(rects[1].attrs.x) - (Number(rects[0].attrs.x) + Number(rects[0].attrs.width));
    expect(gap).toBe(0);
    expect(fusion.some((element) => element.attrs["data-connector"] === "junction")).toBe(false);
    expect(fusion.some((element) => element.tag === "line" && element.attrs["stroke-dasharray"] !== undefined)).toBe(false);
  });

  it("joins half-width breakpoint exons directly and omits the middle dashed line for exon interior mode", () => {
    const interior: FusionPlotSpec = {
      ...spec,
      fivePrime: { ...spec.fivePrime, resolution: { transcriptId: "tx", chromosome: "chr1", position: 100, strand: "+", region: "exon", codingRegion: "unknown", exonNumber: 1, breakpointLocation: "interior" } },
      threePrime: { ...spec.threePrime, resolution: { transcriptId: "tx2", chromosome: "chr2", position: 200, strand: "+", region: "exon", codingRegion: "unknown", exonNumber: 2, breakpointLocation: "interior" } },
      fusion: { ...spec.fusion, fivePrimeExons: [{ label: "1", width: 17 }], threePrimeExons: [{ label: "2", width: 17 }] },
    };
    const model = layoutFusion(interior);
    const fusion = model.layers.find((layer) => layer.id === "fusion-transcript")?.elements ?? [];
    const rects = fusion.filter((element) => element.tag === "rect");
    const gap = Number(rects[1].attrs.x) - (Number(rects[0].attrs.x) + Number(rects[0].attrs.width));
    expect(gap).toBe(0);
    expect(rects.map((element) => Number(element.attrs.width))).toEqual([17, 17]);
    expect(fusion.some((element) => element.attrs["data-connector"] === "junction")).toBe(false);
  });

  it("keeps the middle dashed line and gap for intron mode", () => {
    const intron: FusionPlotSpec = {
      ...spec,
      fivePrime: { ...spec.fivePrime, resolution: { transcriptId: "tx", chromosome: "chr1", position: 100, strand: "+", region: "intron", codingRegion: "unknown", intronNumber: 1 } },
      threePrime: { ...spec.threePrime, resolution: { transcriptId: "tx2", chromosome: "chr2", position: 200, strand: "+", region: "intron", codingRegion: "unknown", intronNumber: 1 } },
      fusion: { ...spec.fusion, fivePrimeExons: [{ label: "1" }], threePrimeExons: [{ label: "2" }] },
    };
    const model = layoutFusion(intron);
    const fusion = model.layers.find((layer) => layer.id === "fusion-transcript")?.elements ?? [];
    const rects = fusion.filter((element) => element.tag === "rect");
    const gap = Number(rects[1].attrs.x) - (Number(rects[0].attrs.x) + Number(rects[0].attrs.width));
    expect(gap).toBe(32);
    const junction = fusion.find((element) => element.attrs["data-connector"] === "junction");
    expect(junction?.tag).toBe("line");
    expect(junction?.attrs["stroke-dasharray"]).toBe("5 4");
  });

  it("keeps the exon-side breakpoint exon directly against the junction in mixed intron/exon modes", () => {
    const makeMixed = (fiveIntron: boolean): FusionPlotSpec => ({
      ...spec,
      fivePrime: {
        ...spec.fivePrime,
        resolution: fiveIntron
          ? { transcriptId: "tx", chromosome: "chr1", position: 100, strand: "+", region: "intron", codingRegion: "unknown", intronNumber: 1 }
          : { transcriptId: "tx", chromosome: "chr1", position: 100, strand: "+", region: "exon", codingRegion: "unknown", exonNumber: 1 },
      },
      threePrime: {
        ...spec.threePrime,
        resolution: fiveIntron
          ? { transcriptId: "tx2", chromosome: "chr2", position: 200, strand: "+", region: "exon", codingRegion: "unknown", exonNumber: 2 }
          : { transcriptId: "tx2", chromosome: "chr2", position: 200, strand: "+", region: "intron", codingRegion: "unknown", intronNumber: 1 },
      },
      fusion: { ...spec.fusion, fivePrimeExons: [{ label: "1" }], threePrimeExons: [{ label: "2" }] },
    });

    for (const fiveIntron of [true, false]) {
      const model = layoutFusion(makeMixed(fiveIntron));
      const fusion = model.layers.find((layer) => layer.id === "fusion-transcript")?.elements ?? [];
      const rects = fusion.filter((element) => element.tag === "rect");
      const fiveEnd = Number(rects[0].attrs.x) + Number(rects[0].attrs.width);
      const threeStart = Number(rects[1].attrs.x);
      const marker = fusion.find((element) => element.attrs["data-breakpoint"] === "true");
      const junction = fusion.find((element) => element.attrs["data-connector"] === "junction");
      expect(junction?.attrs["stroke-dasharray"]).toBe("5 4");
      expect(fiveIntron ? threeStart : fiveEnd).toBe(Number(marker!.attrs.x1));
      // The exon-side block touches the red junction marker.
      expect(fiveIntron ? threeStart : fiveEnd).toBe(Number(marker!.attrs.x2));
    }
  });

  it("renders both partner breakpoint coordinates beneath the fused transcript", () => {
    const withBreakpoints: FusionPlotSpec = {
      ...spec,
      fivePrime: { ...spec.fivePrime, chromosome: "chr2", breakpoint: 42464000 },
      threePrime: { ...spec.threePrime, chromosome: "chr2", breakpoint: 29446000 },
    };
    const model = layoutFusion(withBreakpoints);
    const texts = (model.layers.find((layer) => layer.id === "fusion-transcript")?.elements ?? []).filter((element) => element.tag === "text");
    const coords = texts.filter((element) => element.attrs["data-breakpoint-coord"] !== undefined);
    expect(coords.map((element) => element.text)).toEqual(["chr2:42464000", "chr2:29446000"]);
    expect(coords[0].attrs["text-anchor"]).toBe("end");
    expect(coords[1].attrs["text-anchor"]).toBe("start");
    // Boundary-mode blocks touch, but coordinate labels remain separated.
    expect(Number(coords[1].attrs.x) - Number(coords[0].attrs.x)).toBe(24);
    // The fusion name stays clearly below the coordinate row.
    const name = texts.find((element) => element.text === "A::B");
    expect(Number(name!.attrs.y)).toBeGreaterThanOrEqual(Number(coords[0].attrs.y) + 30);
    const svg = renderFusionSvg(withBreakpoints);
    expect(svg).toContain("chr2:42464000");
    expect(svg).toContain("chr2:29446000");
  });

  it("right-aligns the 3′ gene name and transcript id to its source track", () => {
    const withTranscript: FusionPlotSpec = {
      ...spec,
      threePrime: { ...spec.threePrime, transcript: { id: "NM_004304.5", exons: [{ label: "1", width: 30 }, { label: "2", width: 45 }] } },
    };
    const model = layoutFusion(withTranscript);
    const source = model.layers.find((layer) => layer.id === "source-genes")?.elements ?? [];
    const rightRects = source.filter((element) => element.tag === "rect" && Number(element.attrs.x) >= 600);
    const rightEdge = Math.max(...rightRects.map((element) => Number(element.attrs.x) + Number(element.attrs.width)));
    const geneName = source.find((element) => element.tag === "text" && element.text === "B")!;
    const transcript = source.find((element) => element.tag === "text" && element.text === "NM_004304.5")!;
    expect(geneName.attrs["text-anchor"]).toBe("end");
    expect(transcript.attrs["text-anchor"]).toBe("end");
    expect(Number(geneName.attrs.x)).toBe(rightEdge);
    expect(Number(transcript.attrs.x)).toBe(rightEdge);
  });

  it("renders optional partner base sequences above the fusion name with matching colors", () => {
    const withSequences: FusionPlotSpec = {
      ...spec,
      style: { primaryColor: "#123456", secondaryColor: "#abcdef" },
      fivePrime: { ...spec.fivePrime, baseSequence: "CGACGATCGAGATCGATCGACGA" },
      threePrime: { ...spec.threePrime, baseSequence: "TTAGGCCTAA" },
    };
    const model = layoutFusion(withSequences);
    const fusion = model.layers.find((layer) => layer.id === "fusion-transcript")?.elements ?? [];
    const sequences = fusion.filter((element) => element.attrs["data-base-sequence"] !== undefined);
    expect(sequences.map((element) => element.text)).toEqual(["CGACGATCGAGATCGATCGACGA", "TTAGGCCTAA"]);
    expect(sequences[0].attrs.fill).toBe("#123456");
    expect(sequences[1].attrs.fill).toBe("#abcdef");
    expect(sequences[0].attrs["text-anchor"]).toBe("end");
    expect(sequences[1].attrs["text-anchor"]).toBe("start");
    expect(Number(sequences[0].attrs.x)).toBe(Number(sequences[1].attrs.x));
    expect(Number(sequences[0].attrs.y)).toBe(459);
    const name = fusion.find((element) => element.text === "A::B");
    expect(Number(name!.attrs.y)).toBeGreaterThan(Number(sequences[0].attrs.y));
    const svg = renderFusionSvg(withSequences);
    expect(svg).toContain("CGACGATCGAGATCGATCGACGA");
    expect(svg).toContain("TTAGGCCTAA");
  });

  it("does not render partner base sequences when their values are empty", () => {
    const model = layoutFusion(spec);
    const fusion = model.layers.find((layer) => layer.id === "fusion-transcript")?.elements ?? [];
    expect(fusion.some((element) => element.attrs["data-base-sequence"] !== undefined)).toBe(false);
  });

  it("does not render a FusionView watermark in the drawing area", () => {
    const svg = renderFusionSvg(spec);
    expect(svg).not.toContain(">FusionView<");
  });

  it("draws a right-pointing direction arrow for plus-strand genes", () => {
    const plus: FusionPlotSpec = {
      ...spec,
      fivePrime: { ...spec.fivePrime, strand: "+", transcript: { exons: [{ label: "1", width: 30 }, { label: "2", width: 30 }] } },
    };
    const source = layoutFusion(plus).layers.find((layer) => layer.id === "source-genes")?.elements ?? [];
    const arrow = source.find((element) => element.tag === "polygon" && element.attrs["data-strand"] === "+");
    expect(arrow).toBeDefined();
    const points = String(arrow!.attrs.points).split(" ").map((point) => point.split(",").map(Number));
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const tipX = Math.max(...xs);
    const baseX = Math.min(...xs);
    expect(tipX).toBeGreaterThan(baseX);
    // The arrowhead is slender: clearly longer than it is tall.
    const length = tipX - baseX;
    const height = Math.max(...ys) - Math.min(...ys);
    expect(length).toBe(14);
    expect(height).toBe(8);
    expect(length).toBeGreaterThan(height);
    const texts = source.filter((element) => element.tag === "text").map((element) => element.text);
    expect(texts.indexOf("5′")).toBeLessThan(texts.indexOf("3′"));
  });

  it("protrudes a shaft stub at the 5′ end of the direction arrow", () => {
    const plus: FusionPlotSpec = {
      ...spec,
      fivePrime: { ...spec.fivePrime, strand: "+", transcript: { exons: [{ label: "1", width: 30 }, { label: "2", width: 30 }] } },
    };
    const model = layoutFusion(plus);
    const source = model.layers.find((layer) => layer.id === "source-genes")?.elements ?? [];
    const arrow = source.find((element) => element.tag === "polygon" && element.attrs["data-strand"] === "+")!;
    const points = String(arrow.attrs.points).split(" ").map((point) => point.split(",").map(Number));
    const arrowY = points[2][1];
    // 5′ end of the plus-strand chain starts at x=72; the stub protrudes left of it.
    const stub = source.find((element) => element.tag === "line" && Number(element.attrs.y1) === arrowY && Number(element.attrs.x2) < 72);
    expect(stub).toBeDefined();
    expect(Number(stub!.attrs.x1)).toBe(60);
    expect(Number(stub!.attrs.x2)).toBe(70);
  });

  it("does not let the chromosome brace descend below the top corners of the gene track", () => {
    const withChromosomes: FusionPlotSpec = {
      ...spec,
      fivePrime: { ...spec.fivePrime, chromosome: "chr1", breakpoint: 50, chromosomeLength: 100, transcript: { exons: [{ label: "1", width: 30 }, { label: "2", width: 45 }] } },
      threePrime: { ...spec.threePrime, chromosome: "chr2", breakpoint: 75, chromosomeLength: 100, transcript: { exons: [{ label: "1", width: 30 }, { label: "2", width: 45 }] } },
      chromosomeView: { show: true },
    };
    const model = layoutFusion(withChromosomes);
    const braces = model.layers.find((layer) => layer.id === "chromosome-connectors")?.elements ?? [];
    expect(braces).toHaveLength(2);
    for (const brace of braces) {
      const ys = [...String(brace.attrs.d).matchAll(/([\d.]+) ([\d.]+)/g)].map((match) => Number(match[2]));
      expect(Math.max(...ys)).toBeLessThanOrEqual(205);
    }
  });

  it("draws a left-pointing direction arrow for minus-strand genes", () => {
    const minus: FusionPlotSpec = {
      ...spec,
      fivePrime: { ...spec.fivePrime, strand: "-", transcript: { exons: [{ label: "1", width: 30 }, { label: "2", width: 30 }] } },
    };
    const source = layoutFusion(minus).layers.find((layer) => layer.id === "source-genes")?.elements ?? [];
    const arrow = source.find((element) => element.tag === "polygon" && element.attrs["data-strand"] === "-");
    expect(arrow).toBeDefined();
    const points = String(arrow!.attrs.points).split(" ").map((point) => point.split(",").map(Number));
    const tipX = Math.min(...points.map((point) => point[0]));
    const baseX = Math.max(...points.map((point) => point[0]));
    expect(tipX).toBeLessThan(baseX);
  });

  it("omits the direction arrow when no strand is set", () => {
    const source = layoutFusion(spec).layers.find((layer) => layer.id === "source-genes")?.elements ?? [];
    expect(source.some((element) => element.attrs["data-strand"] !== undefined)).toBe(false);
  });

  it("emits a source breakpoint marker for an intronic resolution", () => {
    const intronic: FusionPlotSpec = {
      ...spec,
      fivePrime: {
        ...spec.fivePrime,
        chromosome: "chr1",
        breakpoint: 150,
        strand: "+",
        transcript: { exons: [{ label: "1", genomicStart: 100, genomicEnd: 120 }, { label: "2", genomicStart: 180, genomicEnd: 200 }] },
        resolution: { transcriptId: "tx", chromosome: "chr1", position: 150, strand: "+", region: "intron", codingRegion: "unknown", intronNumber: 1 },
      },
      geneView: { layout: "schematic" },
    };
    const sourceLayer = layoutFusion(intronic).layers.find((layer) => layer.id === "source-genes");
    expect(sourceLayer?.elements.some((element) => element.attrs["data-breakpoint"] === "true")).toBe(true);
  });

  it("warns when genomic layout is requested for coordinate-free source exons", () => {
    const model = layoutFusion({ ...spec, geneView: { layout: "genomic" } });
    expect(model.warnings.length).toBeGreaterThan(0);
  });

  it("keeps a stable design viewBox for responsive viewport sizes", () => {
    const model = layoutFusion(spec, { width: 420, height: 280 });
    expect(model.width).toBe(420);
    expect(model.height).toBe(280);
    expect(model.viewBox).toBe("0 0 1120 600");
    expect(renderFusionSvg(spec, { width: 0, height: -1 })).toContain('width="1120" height="600"');
  });

  it("preserves coordinate-free manual exon order on a negative strand", () => {
    const manual: FusionPlotSpec = {
      ...spec,
      fivePrime: { ...spec.fivePrime, strand: "-", transcript: { exons: [{ label: "A" }, { label: "B" }] } },
      geneView: { layout: "schematic" },
    };
    const model = layoutFusion(manual);
    const source = model.layers.find((layer) => layer.id === "source-genes")?.elements ?? [];
    const labels = source.filter((element) => element.tag === "text").map((element) => element.text);
    expect(labels).toContain("A");
    expect(labels).toContain("B");
    expect(labels.indexOf("A")).toBeLessThan(labels.indexOf("B"));
  });

  it("preserves explicit manual exon order even when coordinates are supplied", () => {
    const manual: FusionPlotSpec = {
      ...spec,
      fivePrime: {
        ...spec.fivePrime,
        strand: "-",
        manual: true,
        transcript: { exons: [
          { label: "first", genomicStart: 900, genomicEnd: 950 },
          { label: "second", genomicStart: 100, genomicEnd: 150 },
        ] },
      },
      geneView: { layout: "schematic" },
    };
    const source = layoutFusion(manual).layers.find((layer) => layer.id === "source-genes")?.elements ?? [];
    const labels = source.filter((element) => element.tag === "text").map((element) => element.text);
    expect(labels.indexOf("first")).toBeLessThan(labels.indexOf("second"));
  });
});
