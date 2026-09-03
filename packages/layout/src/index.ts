import type { FusionPlotSpec, PlotExon, PlotPartner } from "@fusionview/core";

export interface Viewport { width?: number; height?: number; }
export interface VisualElement {
  tag: "rect" | "line" | "path" | "circle" | "text" | "polygon";
  attrs: Record<string, string | number | undefined>;
  text?: string;
}
export interface VisualLayer { id: string; elements: VisualElement[]; }
export interface FusionVisualModel {
  width: number;
  height: number;
  viewBox: string;
  layers: VisualLayer[];
  warnings: string[];
}

const defaults = {
  width: 1120,
  height: 600,
  font: "Inter, Source Han Sans SC, Noto Sans CJK SC, Arial, sans-serif",
  primary: "#2563eb",
  secondary: "#7c3aed",
  breakpoint: "#e11d48",
  ink: "#172033",
  muted: "#64748b",
};

const el = (tag: VisualElement["tag"], attrs: VisualElement["attrs"], text?: string): VisualElement => ({ tag, attrs, text });

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function exonWidth(exon: PlotExon): number {
  const width = exon.visual?.width ?? exon.width;
  return width !== undefined && Number.isFinite(width) ? Math.max(8, width) : 34;
}

function exonLabel(exon: PlotExon): string { return exon.visual?.label ?? exon.label; }
function exonVisible(exon: PlotExon): boolean { return (exon.visual?.visible ?? exon.visible) !== false; }
function exonType(exon: PlotExon): PlotExon["type"] { return exon.biological?.type ?? exon.type; }
function exonBreakpoint(exon: PlotExon): boolean { return exon.biological?.breakpoint ?? exon.breakpoint ?? false; }
function exonStart(exon: PlotExon): number | undefined { return exon.biological?.genomicStart ?? exon.genomicStart; }
function exonEnd(exon: PlotExon): number | undefined { return exon.biological?.genomicEnd ?? exon.genomicEnd; }
function fontSize(spec: FusionPlotSpec, fallback: number): number { return spec.style?.fontSize ?? fallback; }

function hasCoordinates(exons: PlotExon[]): boolean {
  return exons.length > 0 && exons.every((exon) => exonStart(exon) !== undefined && exonEnd(exon) !== undefined);
}

function preserveManualOrder(partner: PlotPartner): boolean {
  // Resolved annotation records are emitted in genomic order and need a
  // negative-strand reversal for transcript-oriented schematic drawing. A
  // manual/imported PlotSpec, however, treats the array order as the user's
  // explicit structure even when coordinates happen to be present.
  return partner.manual === true || partner.resolution === undefined;
}

function selectedTranscriptExons(partner: PlotPartner, spec: FusionPlotSpec, rangeAnchor?: { label: string; boundary: "start" | "end" }): PlotExon[] {
  const all = partner.transcript.exons;
  const before = spec.geneView?.visibleExonsBefore;
  const after = spec.geneView?.visibleExonsAfter;
  if (before === undefined && after === undefined) return all;
  const pivotNumber = partner.resolution?.exonNumber ?? partner.resolution?.intronNumber;
  if (pivotNumber === undefined) return all;
  // Resolved annotation exons are genomic-order records. Coordinate-free
  // manual specs have no authoritative genomic direction, so preserve their
  // user-provided order even when a strand is supplied.
  const transcriptOrder = !preserveManualOrder(partner) && partner.strand === "-" && hasCoordinates(all)
    ? [...all].reverse()
    : [...all];
  // Visibility is annotation-relative; a visual label override must not move
  // the biological breakpoint pivot.
  const pivot = transcriptOrder.findIndex((exon) => exon.label === String(pivotNumber));
  if (pivot < 0) return all;
  let from = Math.max(0, pivot - (before ?? transcriptOrder.length));
  let to = Math.min(transcriptOrder.length, pivot + 1 + (after ?? transcriptOrder.length));
  // Keep the retained fusion range in view. A 5′ fusion starts at the
  // transcript's first retained exon and a 3′ fusion ends at its last retained
  // exon, so those endpoint exons must be laid out for the range connectors.
  if (rangeAnchor) {
    const anchorIndex = transcriptOrder.findIndex((exon) => exonLabel(exon) === rangeAnchor.label);
    if (anchorIndex >= 0) {
      if (rangeAnchor.boundary === "start") from = Math.min(from, anchorIndex);
      else to = Math.max(to, anchorIndex + 1);
    }
  }
  const selected = new Set(transcriptOrder.slice(from, to));
  return all.filter((exon) => selected.has(exon));
}

interface GeneTrackLayout {
  positions: { exon: PlotExon; x: number; width: number }[];
  startX: number;
  endX: number;
  y: number;
  breakpointX?: number;
}

function layoutGeneTrack(partner: PlotPartner, y: number, side: "left" | "right", spec: FusionPlotSpec): GeneTrackLayout {
  // The retained-range endpoint exon (first for the 5′ partner, last for the
  // 3′ partner) anchors the extra dashed connector, so keep it inside the
  // visible exon window even when it lies beyond visibleExonsBefore/After.
  const fusionExons = (side === "left" ? spec.fusion.fivePrimeExons : spec.fusion.threePrimeExons).filter(exonVisible);
  const anchorExon = side === "left" ? fusionExons[0] : fusionExons[fusionExons.length - 1];
  const rangeAnchor = anchorExon ? { label: exonLabel(anchorExon), boundary: side === "left" ? "start" as const : "end" as const } : undefined;
  const exons = selectedTranscriptExons(partner, spec, rangeAnchor).filter(exonVisible);
  const startX = side === "left" ? 72 : 700;
  const available = side === "left" ? 460 : 340;
  const genomicRequested = spec.geneView?.layout === "genomic";
  const coordinates = hasCoordinates(exons);
  const genomic = genomicRequested && coordinates;
  // Source genes are drawn in genomic orientation (plus-strand genes point
  // right, minus-strand genes point left) so the direction arrow matches the
  // displayed exon order. Manual specs keep the user's explicit order.
  const ordered = genomic
    ? [...exons].sort((a, b) => (exonStart(a)! - exonStart(b)!) || (exonEnd(a)! - exonEnd(b)!))
    : exons;

  let positions: { exon: PlotExon; x: number; width: number }[];
  if (genomic) {
    const min = Math.min(...ordered.map((exon) => exonStart(exon)!));
    const max = Math.max(...ordered.map((exon) => exonEnd(exon)!));
    const scale = available / Math.max(1, max - min + 1);
    positions = ordered.map((exon) => ({
      exon,
      x: startX + (exonStart(exon)! - min) * scale,
      width: (exon.visual?.width ?? exon.width) !== undefined
        ? Math.min(available, Math.max(8, exonWidth(exon)))
        : Math.max(8, (exonEnd(exon)! - exonStart(exon)! + 1) * scale),
    }));
  } else {
    const baseWidths = ordered.map(exonWidth);
    const baseGap = 14;
    const total = baseWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, baseWidths.length - 1) * baseGap;
    const fit = Math.min(1, available / Math.max(total, 1));
    const gap = baseGap * fit;
    let x = startX;
    positions = ordered.map((exon, index) => {
      const width = baseWidths[index] * fit;
      const result = { exon, x, width };
      x += width + gap;
      return result;
    });
  }

  const endX = positions.length > 0
    ? positions[positions.length - 1].x + positions[positions.length - 1].width
    : startX;

  // Source transcript breakpoints are shown even when the breakpoint lies in
  // an intron (where no partial exon marker exists). In genomic mode use the
  // real coordinate; in schematic mode place it at the exon boundary implied
  // by the resolved exon/intron number.
  let breakpointX: number | undefined;
  if (partner.breakpoint !== undefined && positions.length > 0) {
    if (genomic) {
      const min = Math.min(...ordered.map((exon) => exonStart(exon)!));
      const max = Math.max(...ordered.map((exon) => exonEnd(exon)!));
      breakpointX = startX + clamp((partner.breakpoint - min) / Math.max(1, max - min + 1), 0, 1) * available;
    } else {
      const exonNumber = partner.resolution?.exonNumber ?? partner.resolution?.intronNumber;
      const index = exonNumber === undefined ? -1 : ordered.findIndex((exon) => exon.label === String(exonNumber));
      if (index >= 0) {
        const intronNeighborIndex = partner.strand === "-" ? index - 1 : index + 1;
        if (partner.resolution?.region === "intron" && positions[intronNeighborIndex]) {
          // Intronic breakpoints sit between the two flanking exons. The
          // neighboring visual position is on the opposite array side for a
          // negative-strand transcript drawn in genomic orientation.
          const first = positions[Math.min(index, intronNeighborIndex)];
          const second = positions[Math.max(index, intronNeighborIndex)];
          breakpointX = (first.x + first.width + second.x) / 2;
        } else if (partner.resolution?.breakpointLocation === "interior") {
          // A mid-exon breakpoint anchors at the exon center.
          breakpointX = positions[index].x + positions[index].width / 2;
        } else {
          // Boundary breakpoints sit at the retained-range edge of the exon.
          // In genomic orientation, the edge is determined by both strand and
          // partner role; a negative-strand 3′ partner such as ALK therefore
          // uses the right edge of its breakpoint exon.
          const transcriptRunsRight = partner.strand !== "-";
          const retainedRangeEndsRight = side === "left" ? transcriptRunsRight : !transcriptRunsRight;
          breakpointX = retainedRangeEndsRight ? positions[index].x + positions[index].width : positions[index].x;
        }
      }
    }
  }

  return { positions, startX, endX, y, breakpointX };
}

function geneTrack(partner: PlotPartner, y: number, color: string, spec: FusionPlotSpec, layout: GeneTrackLayout, align: "left" | "right"): VisualElement[] {
  const elements: VisualElement[] = [];
  const { positions, startX, endX, breakpointX } = layout;
  const textX = align === "right" ? endX : startX;
  const textAnchor = align === "right" ? "end" : "start";

  // Crowded exon tracks only label the first, last and breakpoint exons
  // unless the caller asks to show every exon number.
  const showEveryLabel = partner.showAllExonLabels === true;
  const breakpointExonNumber = partner.resolution?.exonNumber;
  const labelVisible = (exon: PlotExon, index: number): boolean => showEveryLabel
    || index === 0
    || index === positions.length - 1
    || (breakpointExonNumber !== undefined && exon.label === String(breakpointExonNumber));

  positions.forEach(({ exon, x, width }, index) => {
    const previous = positions[index - 1];
    if (previous) elements.push(el("line", { x1: previous.x + previous.width, y1: y + 12, x2: x, y2: y + 12, stroke: defaults.muted, "stroke-width": 1.5 }));
    elements.push(el("rect", { x, y, width, height: 24, rx: 3, fill: exonType(exon) === "utr" ? "#cbd5e1" : color, opacity: exonVisible(exon) ? 1 : 0.2, "data-exon": exonLabel(exon) }));
    if (labelVisible(exon, index)) elements.push(el("text", { x: x + width / 2, y: y - 7, "text-anchor": "middle", fill: defaults.ink, "font-size": fontSize(spec, 12), "font-family": spec.style?.fontFamily ?? defaults.font }, exonLabel(exon)));
    if (exonBreakpoint(exon)) elements.push(el("line", { x1: x + width / 2, y1: y - 2, x2: x + width / 2, y2: y + 30, stroke: spec.style?.breakpointColor ?? defaults.breakpoint, "stroke-width": 2.5, "stroke-dasharray": "4 3" }));
  });
  if (breakpointX !== undefined) {
    elements.push(el("line", { x1: breakpointX, y1: y - 8, x2: breakpointX, y2: y + 36, stroke: spec.style?.breakpointColor ?? defaults.breakpoint, "stroke-width": 2.5, "stroke-dasharray": "5 3", "data-breakpoint": "true" }));
  }
  // Transcription direction: a slender, elongated arrowhead at the 3′ end of
  // the displayed chain plus a short shaft stub protruding at the 5′ end, with
  // 5′/3′ labels outside both. Genes without a strand stay unlabeled instead
  // of guessing a direction.
  if (partner.strand && positions.length > 0) {
    const chainStartX = positions[0].x;
    const chainEndX = positions[positions.length - 1].x + positions[positions.length - 1].width;
    const arrowY = y + 12;
    const plus = partner.strand === "+";
    const headX = plus ? chainEndX + 2 : chainStartX - 2;
    const tipX = plus ? headX + 14 : headX - 14;
    elements.push(el("polygon", { points: `${headX},${arrowY - 4} ${headX},${arrowY + 4} ${tipX},${arrowY}`, fill: color, "data-strand": partner.strand }));
    // 5′ shaft stub: a short axis segment protruding outward from the 5′ end.
    if (plus) {
      elements.push(el("line", { x1: chainStartX - 12, y1: arrowY, x2: chainStartX - 2, y2: arrowY, stroke: color, "stroke-width": 2 }));
    } else {
      elements.push(el("line", { x1: chainEndX + 2, y1: arrowY, x2: chainEndX + 12, y2: arrowY, stroke: color, "stroke-width": 2 }));
    }
    const leftLabel = plus ? "5′" : "3′";
    const rightLabel = plus ? "3′" : "5′";
    elements.push(el("text", { x: plus ? chainStartX - 24 : chainStartX - 28, y: arrowY + 5, "text-anchor": "middle", fill: defaults.muted, "font-size": fontSize(spec, 11), "font-family": spec.style?.fontFamily ?? defaults.font }, leftLabel));
    elements.push(el("text", { x: chainEndX + 26, y: arrowY + 5, "text-anchor": "middle", fill: defaults.muted, "font-size": fontSize(spec, 11), "font-family": spec.style?.fontFamily ?? defaults.font }, rightLabel));
  }
  elements.push(el("text", { x: textX, y: y + 54, "text-anchor": textAnchor, fill: defaults.ink, "font-size": fontSize(spec, 18), "font-weight": 650, "font-family": spec.style?.fontFamily ?? defaults.font }, partner.gene.displayName ?? partner.gene.symbol));
  // Only the optional transcript id is shown below the gene; the locus lives
  // on the chromosome ideogram above at the breakpoint.
  if (partner.transcript.id) elements.push(el("text", { x: textX, y: y + 74, "text-anchor": textAnchor, fill: defaults.muted, "font-size": fontSize(spec, 12), "font-family": spec.style?.fontFamily ?? defaults.font }, partner.transcript.id));
  return elements;
}

function chromosomeTrack(partner: PlotPartner, x: number, y: number, width: number, color: string, spec: FusionPlotSpec): VisualElement[] {
  const elements: VisualElement[] = [];
  if (!partner.chromosome || !partner.chromosomeLength || spec.chromosomeView?.show === false) return elements;
  elements.push(el("text", { x: x + width / 2, y: y - 10, "text-anchor": "middle", fill: defaults.ink, "font-size": fontSize(spec, 14), "font-family": spec.style?.fontFamily ?? defaults.font }, partner.chromosome));
  elements.push(el("rect", { x, y, width, height: 38, rx: 18, fill: "#f8fafc", stroke: "#94a3b8", "stroke-width": 1.2 }));
  const bands = partner.chromosomeBands ?? [];
  if (spec.chromosomeView?.showCytoband !== false) bands.forEach((band) => {
    const bandX = x + ((band.start - 1) / partner.chromosomeLength!) * width;
    const bandW = Math.max(1, ((band.end - band.start + 1) / partner.chromosomeLength!) * width);
    const stain = band.stain?.toLowerCase();
    const fill = stain?.includes("gneg") ? "#f8fafc" : stain?.includes("acen") ? "#fca5a5" : "#cbd5e1";
    elements.push(el("rect", { x: bandX, y, width: bandW, height: 38, fill, opacity: 0.9 }));
    if (bandW >= 28) {
      elements.push(el("text", { x: bandX + bandW / 2, y: y + 24, "text-anchor": "middle", fill: defaults.muted, "font-size": fontSize(spec, 9), "font-family": spec.style?.fontFamily ?? defaults.font }, band.name));
    }
  });
  if (partner.breakpoint !== undefined) {
    const fraction = clamp((partner.breakpoint - 1) / Math.max(1, partner.chromosomeLength - 1), 0, 1);
    const bpX = x + fraction * width;
    elements.push(el("line", { x1: bpX, y1: y - 4, x2: bpX, y2: y + 43, stroke: spec.style?.breakpointColor ?? defaults.breakpoint, "stroke-width": 3 }));
    // The gene locus is anchored to the ideogram breakpoint rather than being
    // repeated under the gene track.
    const locus = partner.cytoband ?? String(partner.breakpoint);
    elements.push(el("text", { x: bpX, y: y - 16, "text-anchor": "middle", fill: defaults.muted, "font-size": fontSize(spec, 12), "font-family": spec.style?.fontFamily ?? defaults.font, "data-locus": "true" }, locus));
  }
  return elements;
}

function chromosomeConnector(partner: PlotPartner, chromosomeX: number, chromosomeWidth: number, gene: GeneTrackLayout, color: string, spec: FusionPlotSpec): VisualElement[] {
  if (!partner.chromosome || !partner.chromosomeLength || partner.breakpoint === undefined || spec.chromosomeView?.show === false) return [];
  if (gene.positions.length === 0) return [];
  const fraction = clamp((partner.breakpoint - 1) / Math.max(1, partner.chromosomeLength - 1), 0, 1);
  const tipX = chromosomeX + fraction * chromosomeWidth;
  const topY = 110;
  const leftX = gene.startX;
  const rightX = gene.endX;
  const bottomY = gene.y;
  // A single path with two sub-paths draws a downward-opening curly brace:
  // the pointed tip anchors at the chromosome breakpoint and the two arms
  // descend flush to the top-left and top-right corners of the gene track.
  const d = [
    `M ${tipX} ${topY}`,
    `C ${tipX - 6} ${topY + 8}, ${leftX + 10} ${topY + 12}, ${leftX} ${topY + 20}`,
    `L ${leftX} ${bottomY}`,
    `M ${rightX} ${bottomY}`,
    `L ${rightX} ${topY + 20}`,
    `C ${rightX - 10} ${topY + 12}, ${tipX + 6} ${topY + 8}, ${tipX} ${topY}`,
  ].join(" ");
  return [el("path", { d, fill: "none", stroke: color, "stroke-width": 2, "data-brace": "true" })];
}

interface FusionTrackLayout {
  y: number;
  five: { startX: number; endX: number; exons: { exon: PlotExon; x: number; width: number }[] };
  three: { startX: number; endX: number; exons: { exon: PlotExon; x: number; width: number }[] };
  junctionX: number;
}

function layoutFusionBlock(exons: PlotExon[], available: number): { exons: { exon: PlotExon; x: number; width: number }[]; width: number } {
  const ordered = exons.filter(exonVisible);
  const baseWidths = ordered.map(exonWidth);
  const baseGap = 10;
  const total = baseWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, baseWidths.length - 1) * baseGap;
  const fit = Math.min(1, available / Math.max(total, 1));
  const gap = baseGap * fit;
  let x = 0;
  const laid = ordered.map((exon, index) => {
    const width = baseWidths[index] * fit;
    const result = { exon, x, width };
    x += width + gap;
    return result;
  });
  const width = ordered.length > 0 ? x - gap : 0;
  return { exons: laid, width };
}

function layoutFusionTrack(spec: FusionPlotSpec): FusionTrackLayout {
  // Kept close to the source-gene band so the blank distance between the two
  // genes and the fused transcript matches the chromosome-to-gene gap above.
  const y = 385;
  const fiveIntron = spec.fivePrime.resolution?.region === "intron";
  const threeIntron = spec.threePrime.resolution?.region === "intron";
  const intronicJunction = fiveIntron || threeIntron;
  // Put the gap on the intron side. This keeps an exon-side breakpoint exon
  // directly against the red junction marker in mixed-mode fusions. When both
  // sides are intronic, split the existing 32px gap around the marker.
  const junctionGap = intronicJunction ? 32 : 0;
  const fiveGap = fiveIntron ? (threeIntron ? junctionGap / 2 : junctionGap) : 0;
  const threeGap = threeIntron ? (fiveIntron ? junctionGap / 2 : junctionGap) : 0;
  const fiveBlock = layoutFusionBlock(spec.fusion.fivePrimeExons, 390);
  const threeBlock = layoutFusionBlock(spec.fusion.threePrimeExons, 390);
  const total = fiveBlock.width + fiveGap + threeGap + threeBlock.width;
  const fiveStartX = defaults.width / 2 - total / 2;
  const junctionX = fiveStartX + fiveBlock.width + fiveGap;
  const threeStartX = junctionX + threeGap;
  const absolute = (block: { exons: { exon: PlotExon; x: number; width: number }[]; width: number }, startX: number) => ({
    startX,
    endX: startX + block.width,
    exons: block.exons.map((item) => ({ ...item, x: item.x + startX })),
  });
  return {
    y,
    five: absolute(fiveBlock, fiveStartX),
    three: absolute(threeBlock, threeStartX),
    junctionX,
  };
}

function breakpointConnectors(spec: FusionPlotSpec, fiveGene: GeneTrackLayout, threeGene: GeneTrackLayout, fusion: FusionTrackLayout): VisualElement[] {
  const elements: VisualElement[] = [];
  const color = spec.style?.breakpointColor ?? defaults.breakpoint;
  const drop = (fromX: number | undefined, toX: number) => {
    if (fromX === undefined) return;
    elements.push(el("line", { x1: fromX, y1: 241, x2: toX, y2: fusion.y, stroke: color, "stroke-width": 1.8, "stroke-dasharray": "5 4", "data-connector": "breakpoint" }));
  };
  drop(fiveGene.breakpointX, fusion.five.endX);
  drop(threeGene.breakpointX, fusion.three.startX);
  return elements;
}

/** Dashed connectors from the retained-range endpoints (first/last exon) of
 * each source gene down to the corresponding exon in the fusion transcript.
 * These complement the breakpoint connector so the viewer can see which exon
 * range was used to build the fusion. */
function rangeConnectors(spec: FusionPlotSpec, fiveGene: GeneTrackLayout, threeGene: GeneTrackLayout, fusion: FusionTrackLayout): VisualElement[] {
  const elements: VisualElement[] = [];
  const color = spec.style?.breakpointColor ?? defaults.breakpoint;
  const drop = (
    source: { exon: PlotExon; x: number; width: number } | undefined,
    target: { exon: PlotExon; x: number; width: number } | undefined,
    corner: "left" | "right",
  ) => {
    if (!source || !target || exonLabel(source.exon) !== exonLabel(target.exon)) return;
    const targetX = corner === "left" ? target.x : target.x + target.width;
    elements.push(el("line", { x1: source.x + source.width / 2, y1: 241, x2: targetX, y2: fusion.y, stroke: color, "stroke-width": 1.8, "stroke-dasharray": "5 4", "data-connector": "range" }));
  };
  // 5′ partner: retained range starts at the transcript's first exon. Point
  // to its upper-left corner in the fused transcript.
  const fiveTarget = fusion.five.exons[0];
  drop(fiveTarget && fiveGene.positions.find((item) => exonLabel(item.exon) === exonLabel(fiveTarget.exon)), fiveTarget, "left");
  // 3′ partner: retained range ends at the transcript's last exon. Point to
  // its upper-right corner in the fused transcript.
  const threeLast = fusion.three.exons.length > 0 ? fusion.three.exons[fusion.three.exons.length - 1] : undefined;
  drop(threeLast && threeGene.positions.find((item) => exonLabel(item.exon) === exonLabel(threeLast.exon)), threeLast, "right");
  return elements;
}

function fusionTrack(spec: FusionPlotSpec, fusion: FusionTrackLayout): VisualElement[] {
  const elements: VisualElement[] = [];
  const y = fusion.y;

  const renderBlock = (block: FusionTrackLayout["five"], color: string) => {
    block.exons.forEach(({ exon, x, width }, index) => {
      const previous = block.exons[index - 1];
      if (previous) elements.push(el("line", { x1: previous.x + previous.width, y1: y + 15, x2: x, y2: y + 15, stroke: defaults.muted }));
      elements.push(el("rect", { x, y, width, height: 30, rx: 3, fill: color, "data-exon": exonLabel(exon) }));
      elements.push(el("text", { x: x + width / 2, y: y + 20, "text-anchor": "middle", fill: "white", "font-size": fontSize(spec, 11), "font-family": spec.style?.fontFamily ?? defaults.font }, exonLabel(exon)));
      if (exonBreakpoint(exon)) elements.push(el("line", { x1: x + width / 2, y1: y - 2, x2: x + width / 2, y2: y + 34, stroke: spec.style?.breakpointColor ?? defaults.breakpoint, "stroke-width": 2 }));
    });
  };
  renderBlock(fusion.five, spec.style?.primaryColor ?? defaults.primary);
  renderBlock(fusion.three, spec.style?.secondaryColor ?? defaults.secondary);

  if (fusion.five.exons.length > 0 && fusion.three.exons.length > 0) {
    const intronicJunction = spec.fivePrime.resolution?.region === "intron"
      || spec.threePrime.resolution?.region === "intron";
    if (intronicJunction) {
      // Intron mode keeps a visible dashed line between the two fused blocks.
      elements.push(el("line", { x1: fusion.five.endX, y1: y + 15, x2: fusion.three.startX, y2: y + 15, stroke: spec.style?.breakpointColor ?? defaults.breakpoint, "stroke-width": 2, "stroke-dasharray": "5 4", "data-connector": "junction" }));
    }
    // The vertical marker remains at the junction in every mode.
    elements.push(el("line", { x1: fusion.junctionX, y1: y - 6, x2: fusion.junctionX, y2: y + 36, stroke: spec.style?.breakpointColor ?? defaults.breakpoint, "stroke-width": 2.5, "data-breakpoint": "true" }));
  }

  // Breakpoint coordinates of both partners flank the junction beneath the
  // fused transcript, so the exact genomic position of the fusion is visible.
  const breakpointCoordinate = (partner: PlotPartner) => partner.breakpoint !== undefined && partner.chromosome !== undefined
    ? `${partner.chromosome}:${partner.breakpoint}`
    : undefined;
  const fiveCoordinate = breakpointCoordinate(spec.fivePrime);
  const threeCoordinate = breakpointCoordinate(spec.threePrime);
  // Keep coordinate labels readable even when boundary/interior breakpoint
  // exons touch at the junction and both block edges share the same x value.
  const coordinateOffset = 12;
  if (fiveCoordinate !== undefined) {
    elements.push(el("text", { x: fusion.five.endX - coordinateOffset, y: y + 56, "text-anchor": "end", fill: defaults.muted, "font-size": fontSize(spec, 12), "font-family": spec.style?.fontFamily ?? defaults.font, "data-breakpoint-coord": "fivePrime" }, fiveCoordinate));
  }
  if (threeCoordinate !== undefined) {
    elements.push(el("text", { x: fusion.three.startX + coordinateOffset, y: y + 56, "text-anchor": "start", fill: defaults.muted, "font-size": fontSize(spec, 12), "font-family": spec.style?.fontFamily ?? defaults.font, "data-breakpoint-coord": "threePrime" }, threeCoordinate));
  }

  // Base sequences meet at the fusion junction: the 5′ sequence is right
  // aligned and the 3′ sequence is left aligned, so no gap is introduced.
  const fiveSequence = spec.fivePrime.baseSequence?.trim();
  const threeSequence = spec.threePrime.baseSequence?.trim();
  const sequenceFont = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  if (fiveSequence) {
    elements.push(el("text", { x: fusion.junctionX, y: y + 74, "text-anchor": "end", fill: spec.style?.primaryColor ?? defaults.primary, "font-size": fontSize(spec, 12), "font-family": sequenceFont, "data-base-sequence": "fivePrime" }, fiveSequence));
  }
  if (threeSequence) {
    elements.push(el("text", { x: fusion.junctionX, y: y + 74, "text-anchor": "start", fill: spec.style?.secondaryColor ?? defaults.secondary, "font-size": fontSize(spec, 12), "font-family": sequenceFont, "data-base-sequence": "threePrime" }, threeSequence));
  }

  // The fusion name sits further below so it does not crowd the breakpoint
  // coordinate or base-sequence rows above it.
  elements.push(el("text", { x: fusion.junctionX, y: y + 104, "text-anchor": "middle", fill: defaults.ink, "font-size": fontSize(spec, 18), "font-weight": 650, "font-family": spec.style?.fontFamily ?? defaults.font }, spec.fusion.name));
  // The fused transcript reads 5′→3′ left to right; mark that direction.
  const totalVisible = fusion.five.exons.length + fusion.three.exons.length;
  if (totalVisible > 0) {
    const arrowY = y + 15;
    const headX = fusion.three.exons.length > 0 ? fusion.three.endX + 2 : fusion.five.endX + 2;
    // Slender elongated arrowhead at the 3′ end, with a shaft stub protruding
    // at the 5′ end of the fused transcript.
    elements.push(el("line", { x1: fusion.five.startX - 12, y1: arrowY, x2: fusion.five.startX - 2, y2: arrowY, stroke: defaults.muted, "stroke-width": 2 }));
    elements.push(el("polygon", { points: `${headX},${arrowY - 5} ${headX},${arrowY + 5} ${headX + 14},${arrowY}`, fill: defaults.muted }));
    elements.push(el("text", { x: fusion.five.startX - 26, y: arrowY + 5, "text-anchor": "middle", fill: defaults.muted, "font-size": fontSize(spec, 11), "font-family": spec.style?.fontFamily ?? defaults.font }, "5′"));
    elements.push(el("text", { x: headX + 26, y: arrowY + 5, "text-anchor": "middle", fill: defaults.muted, "font-size": fontSize(spec, 11), "font-family": spec.style?.fontFamily ?? defaults.font }, "3′"));
  }
  return elements;
}

export function layoutFusion(spec: FusionPlotSpec, viewport: Viewport = {}): FusionVisualModel {
  const safeViewport: Viewport = viewport && typeof viewport === "object" ? viewport : {};
  const width = safeViewport.width !== undefined && Number.isFinite(safeViewport.width) && safeViewport.width > 0 ? safeViewport.width : defaults.width;
  const height = safeViewport.height !== undefined && Number.isFinite(safeViewport.height) && safeViewport.height > 0 ? safeViewport.height : defaults.height;
  const warnings: string[] = [];
  if (spec.geneView?.layout === "genomic") {
    ([spec.fivePrime, spec.threePrime] as PlotPartner[]).forEach((partner) => {
      if (!hasCoordinates(partner.transcript.exons)) {
        warnings.push(`${partner.gene.symbol}: genomic layout requires coordinates; schematic layout used for coordinate-free exons.`);
      }
    });
  }
  const fiveGene = layoutGeneTrack(spec.fivePrime, 205, "left", spec);
  const threeGene = layoutGeneTrack(spec.threePrime, 205, "right", spec);
  const fusion = layoutFusionTrack(spec);
  const layers: VisualLayer[] = [
    { id: "chromosomes", elements: [
      ...chromosomeTrack(spec.fivePrime, 110, 68, 390, spec.style?.primaryColor ?? defaults.primary, spec),
      ...chromosomeTrack(spec.threePrime, 650, 68, 350, spec.style?.secondaryColor ?? defaults.secondary, spec),
    ] },
    { id: "chromosome-connectors", elements: [
      ...chromosomeConnector(spec.fivePrime, 110, 390, fiveGene, spec.style?.primaryColor ?? defaults.primary, spec),
      ...chromosomeConnector(spec.threePrime, 650, 350, threeGene, spec.style?.secondaryColor ?? defaults.secondary, spec),
    ] },
    { id: "source-genes", elements: [
      ...geneTrack(spec.fivePrime, 205, spec.style?.primaryColor ?? defaults.primary, spec, fiveGene, "left"),
      ...geneTrack(spec.threePrime, 205, spec.style?.secondaryColor ?? defaults.secondary, spec, threeGene, "right"),
    ] },
    { id: "fusion-connectors", elements: [
      ...breakpointConnectors(spec, fiveGene, threeGene, fusion),
      ...rangeConnectors(spec, fiveGene, threeGene, fusion),
    ] },
    { id: "fusion-transcript", elements: fusionTrack(spec, fusion) },
  ];
  return { width, height, viewBox: `0 0 ${defaults.width} ${defaults.height}`, layers, warnings };
}
