import type {
  AnnotationProvider,
  Assembly,
  BreakpointResolution,
  ChromosomeAnnotation,
  ExonAnnotation,
  FusionInput,
  FusionPlotSpec,
  GeneAnnotation,
  PlotExon,
  PlotPartner,
  ResolutionMessage,
  ResolutionResult,
  TranscriptAnnotation,
} from "./types.js";
import { normalizeAssembly, normalizeBreakpoint, normalizeChromosome } from "./normalize.js";

type PartnerRole = "fivePrime" | "threePrime";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value) && value >= 1;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isOptionalNonNegativeInteger(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value) && value >= 0);
}

function isValidRange(start: unknown, end: unknown): boolean {
  return isPositiveInteger(start) && isPositiveInteger(end) && (start as number) <= (end as number);
}

function isValidExon(value: unknown): value is ExonAnnotation {
  if (!isRecord(value)
    || (typeof value.id === "string" && !value.id.trim())
    || typeof value.id !== "string" && value.id !== undefined
    || !isValidRange(value.start, value.end)
    || !isPositiveInteger(value.exonNumber)) return false;
  if (value.cdsStart !== undefined && !isPositiveInteger(value.cdsStart)) return false;
  if (value.cdsEnd !== undefined && !isPositiveInteger(value.cdsEnd)) return false;
  const start = value.start as number;
  const end = value.end as number;
  if (isPositiveInteger(value.cdsStart) && (value.cdsStart < start || value.cdsStart > end)) return false;
  if (isPositiveInteger(value.cdsEnd) && (value.cdsEnd < start || value.cdsEnd > end)) return false;
  if (isPositiveInteger(value.cdsStart) && isPositiveInteger(value.cdsEnd) && value.cdsStart > value.cdsEnd) return false;
  return true;
}

function isValidTranscript(value: unknown): value is TranscriptAnnotation {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || !value.id.trim()
    || !isOptionalString(value.displayName)
    || !isValidRange(value.start, value.end)
    || (value.strand !== "+" && value.strand !== "-")
    || !isOptionalString(value.biotype)
    || !isOptionalBoolean(value.canonical)
    || !isOptionalBoolean(value.maneSelect)
    || !isOptionalBoolean(value.manePlusClinical)
    || !isOptionalString(value.appris)
    || !isOptionalBoolean(value.ccds)
    || !isOptionalNonNegativeInteger(value.cdsLength)
    || !Array.isArray(value.exons)) return false;
  return value.exons.every(isValidExon);
}

function isValidGene(value: unknown): value is GeneAnnotation {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || !value.id.trim()
    || typeof value.symbol !== "string"
    || !value.symbol.trim()
    || !isOptionalString(value.displayName)
    || typeof value.chromosome !== "string"
    || !value.chromosome.trim()
    || !isValidRange(value.start, value.end)
    || (value.strand !== "+" && value.strand !== "-")
    || !Array.isArray(value.transcripts)) return false;
  const transcriptIds = new Set<string>();
  return value.transcripts.every((transcript) => {
    if (!isValidTranscript(transcript) || transcriptIds.has(transcript.id)) return false;
    transcriptIds.add(transcript.id);
    return transcript.strand === value.strand;
  });
}

function hasValidTranscriptStructure(transcript: TranscriptAnnotation): boolean {
  // Keep this check separate from the gene-level shape check. Annotation
  // packs can contain a transcript whose declared span is stale; that record
  // should be skipped during automatic ranking while valid sibling
  // transcripts remain usable.
  const seenNumbers = new Set<number>();
  const seenIntervals = new Set<string>();
  for (const exon of transcript.exons) {
    if (exon.start < transcript.start || exon.end > transcript.end) return false;
    if (seenNumbers.has(exon.exonNumber)) return false;
    seenNumbers.add(exon.exonNumber);
    const interval = `${exon.start}:${exon.end}`;
    if (seenIntervals.has(interval)) return false;
    seenIntervals.add(interval);
  }
  const genomicExons = [...transcript.exons].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < genomicExons.length; index += 1) {
    if (genomicExons[index].start <= genomicExons[index - 1].end) return false;
  }
  return true;
}

function transcriptWithinGene(gene: GeneAnnotation, transcript: TranscriptAnnotation): boolean {
  return transcript.start >= gene.start && transcript.end <= gene.end;
}

function breakpointHasTranscriptLocation(transcript: TranscriptAnnotation, position: number): boolean {
  const exons = [...transcript.exons].sort((a, b) => a.start - b.start || a.end - b.end);
  if (exons.some((exon) => position >= exon.start && position <= exon.end)) return true;
  return exons.some((exon, index) => {
    const next = exons[index + 1];
    return next !== undefined && position > exon.end && position < next.start;
  });
}

function isValidChromosome(value: unknown): value is ChromosomeAnnotation {
  if (!isRecord(value)
    || typeof value.name !== "string"
    || !value.name.trim()
    || !isPositiveInteger(value.length)) return false;
  if (value.bands === undefined) return true;
  if (!Array.isArray(value.bands)) return false;
  const length = value.length as number;
  let previousEnd = 0;
  const valid = value.bands.every((band) => isRecord(band)
    && typeof band.name === "string"
    && !!band.name.trim()
    && isValidRange(band.start, band.end)
    && (band.end as number) <= length
    && (band.stain === undefined || typeof band.stain === "string")
    && (band.start as number) > previousEnd
    && ((previousEnd = band.end as number) > 0));
  return valid;
}

function message(code: string, text: string, partner: PartnerRole | undefined, severity: "warning" | "error"): ResolutionMessage {
  // `partner` is optional in the public error contract. Do not materialize an
  // `undefined` property on global diagnostics: this keeps serialized errors
  // stable and lets consumers distinguish global from partner errors with a
  // simple `"partner" in message` check.
  return partner === undefined
    ? { code, message: text, severity }
    : { code, message: text, partner, severity };
}

function providerErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string" && /assembly/i.test(error.code)) {
    return "ASSEMBLY_MISMATCH";
  }
  return /annotation pack is|requested .* assembly|assembly mismatch|wrong assembly/i.test(String(error))
    ? "ASSEMBLY_MISMATCH"
    : "ANNOTATION_LOOKUP_FAILED";
}

function geneInput(input: FusionInput["fivePrime"]): { symbol?: string; id?: string } {
  if (!isRecord(input)) throw new Error("Partner input is required.");
  if (typeof input.gene === "string") {
    const symbol = input.gene.trim();
    if (!symbol) throw new Error("Gene symbol is required.");
    return { symbol };
  }
  if (!isRecord(input.gene) || typeof input.gene.symbol !== "string") {
    throw new Error("Gene symbol is required.");
  }
  const symbol = input.gene.symbol.trim();
  if (!symbol) throw new Error("Gene symbol is required.");
  if (input.gene.id !== undefined && (typeof input.gene.id !== "string" || !input.gene.id.trim())) {
    throw new Error("Gene id must be a non-empty string.");
  }
  if (input.gene.displayName !== undefined && typeof input.gene.displayName !== "string") {
    throw new Error("Gene displayName must be a string.");
  }
  return { symbol, id: input.gene.id?.trim() || undefined };
}

function isApprisPrincipal(value: string | undefined): boolean {
  if (!value) return false;
  return value
    .split(/[;,\s]+/)
    .map((item) => item.trim().toLowerCase())
    // GENCODE has used `principal`, `principal_1`, `principal1`, and the
    // prefixed `appris_principal_1` spelling over time.
    .some((item) => /^(?:appris[_-])?principal(?:[_-]?\d+)?$/.test(item));
}

/** Stable, documented transcript ranking used after breakpoint compatibility filtering. */
function compareRank(a: TranscriptAnnotation, b: TranscriptAnnotation): number {
  const aa: number[] = [
    a.maneSelect ? 0 : 1,
    a.manePlusClinical ? 0 : 1,
    isApprisPrincipal(a.appris) ? 0 : 1,
    a.canonical ? 0 : 1,
    a.ccds ? 0 : 1,
    -transcriptCdsLength(a),
    -(a.end - a.start),
  ];
  const bb: number[] = [
    b.maneSelect ? 0 : 1,
    b.manePlusClinical ? 0 : 1,
    isApprisPrincipal(b.appris) ? 0 : 1,
    b.canonical ? 0 : 1,
    b.ccds ? 0 : 1,
    -transcriptCdsLength(b),
    -(b.end - b.start),
  ];
  for (let i = 0; i < aa.length; i += 1) {
    if (aa[i] < bb[i]) return -1;
    if (aa[i] > bb[i]) return 1;
  }
  // Avoid locale-dependent ordering: transcript ranking must be reproducible
  // across browsers, hosts and user language settings.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function classifyExon(exon: ExonAnnotation, position: number): "cds" | "utr" | "noncoding" {
  // GTF fixtures and older annotation packs may provide only one CDS edge.
  // Treat the missing edge as the exon boundary rather than misclassifying a
  // partially described coding exon as wholly non-coding.
  if (exon.cdsStart === undefined && exon.cdsEnd === undefined) return "noncoding";
  const cdsStart = exon.cdsStart ?? exon.start;
  const cdsEnd = exon.cdsEnd ?? exon.end;
  return position >= cdsStart && position <= cdsEnd ? "cds" : "utr";
}

function transcriptCdsLength(transcript: TranscriptAnnotation): number {
  const derived = transcript.exons.reduce((sum, exon) => {
    if (exon.cdsStart === undefined && exon.cdsEnd === undefined) return sum;
    const start = exon.cdsStart ?? exon.start;
    const end = exon.cdsEnd ?? exon.end;
    return sum + Math.max(0, end - start + 1);
  }, 0);
  // Some compact packs use zero as the sentinel for an omitted CDS length.
  // Prefer the explicit positive value, otherwise use the exon-derived value.
  return transcript.cdsLength !== undefined && transcript.cdsLength > 0
    ? transcript.cdsLength
    : derived;
}

function resolveLocation(
  transcript: TranscriptAnnotation,
  position: number,
  chromosome: string,
  cytoband?: string,
): BreakpointResolution {
  // Annotation packs may store exons in genomic order. Never mutate the
  // provider's record while deriving transcript-oriented semantics.
  const exons = [...transcript.exons].sort((a, b) => a.start - b.start || a.end - b.end);
  const exonIndex = exons.findIndex((exon) => position >= exon.start && position <= exon.end);
  if (exonIndex >= 0) {
    const exon = exons[exonIndex];
    // Offsets are 1-based within the exon, in transcript direction.
    const offset = transcript.strand === "+"
      ? position - exon.start + 1
      : exon.end - position + 1;
    return {
      transcriptId: transcript.id,
      chromosome,
      position,
      strand: transcript.strand,
      region: "exon",
      codingRegion: classifyExon(exon, position),
      exonNumber: exon.exonNumber,
      exonOffset: offset,
      cytoband,
    };
  }

  const intronIndex = exons.findIndex((exon, index) => {
    const next = exons[index + 1];
    return next !== undefined && position > exon.end && position < next.start;
  });
  if (intronIndex >= 0) {
    const left = exons[intronIndex];
    const right = exons[intronIndex + 1];
    // `left` is the lower genomic coordinate. On a minus-strand transcript,
    // the next genomic exon is the earlier transcript exon, so its number is
    // the intron number. This remains correct for non-consecutive exon IDs.
    const fallback = transcript.strand === "+"
      ? intronIndex + 1
      : exons.length - intronIndex - 1;
    const intronNumber = transcript.strand === "+"
      ? (left.exonNumber || fallback)
      : (right.exonNumber || fallback);
    return {
      transcriptId: transcript.id,
      chromosome,
      position,
      strand: transcript.strand,
      region: "intron",
      codingRegion: "unknown",
      intronNumber,
      cytoband,
    };
  }
  return {
    transcriptId: transcript.id,
    chromosome,
    position,
    strand: transcript.strand,
    region: "outside",
    codingRegion: "unknown",
    cytoband,
  };
}

function plotExon(exon: ExonAnnotation, partial?: { start?: number; end?: number }): PlotExon {
  const start = partial?.start ?? exon.start;
  const end = partial?.end ?? exon.end;
  let type: PlotExon["type"] = "unknown";
  if (exon.cdsStart !== undefined || exon.cdsEnd !== undefined) {
    // Older/compact packs may contain only one CDS edge. Treat the missing
    // edge as the exon boundary so partially described CDS records still get
    // a useful coding/UTR classification.
    const cdsStart = exon.cdsStart ?? exon.start;
    const cdsEnd = exon.cdsEnd ?? exon.end;
    // A full exon can be UTR even when another portion of the transcript is
    // coding. Mixed CDS/UTR exons remain represented as coding for V0.1.
    type = end < cdsStart || start > cdsEnd ? "utr" : "coding";
  }
  return {
    id: exon.id,
    label: String(exon.exonNumber),
    genomicStart: start,
    genomicEnd: end,
    type,
  };
}

function retainedExons(transcript: TranscriptAnnotation, position: number, role: PartnerRole): PlotExon[] {
  const ordered = transcript.strand === "+"
    ? [...transcript.exons].sort((a, b) => a.start - b.start || a.end - b.end)
    : [...transcript.exons].sort((a, b) => b.start - a.start || b.end - a.end);
  const fiveSide = role === "fivePrime";
  const keep: PlotExon[] = [];

  ordered.forEach((exon) => {
    const overlaps = position >= exon.start && position <= exon.end;
    const retain = fiveSide
      ? (transcript.strand === "+" ? exon.end <= position : exon.start >= position)
      : (transcript.strand === "+" ? exon.start >= position : exon.end <= position);
    if (overlaps) {
      const clipped = transcript.strand === "+"
        // Breakpoint positions are 1-based bases. The retained 5′ segment
        // includes the breakpoint base; the retained 3′ segment starts at the
        // next base, so the two fusion segments never cover the same base.
        ? (fiveSide
          ? plotExon(exon, { end: position })
          : plotExon(exon, { start: position + 1 }))
        : (fiveSide
          ? plotExon(exon, { start: position })
          : plotExon(exon, { end: position - 1 }));
      if ((clipped.genomicEnd ?? 0) >= (clipped.genomicStart ?? 0)) {
        keep.push({ ...clipped, breakpoint: true });
      }
    } else if (retain) {
      keep.push(plotExon(exon));
    }
  });
  return keep;
}

interface ResolvedPartner {
  partner: PlotPartner;
  transcript: TranscriptAnnotation;
}

async function resolvePartner(
  assembly: Assembly,
  input: FusionInput["fivePrime"] | undefined,
  role: PartnerRole,
  provider: AnnotationProvider,
  warnings: ResolutionMessage[],
  errors: ResolutionMessage[],
): Promise<ResolvedPartner | undefined> {
  if (!isRecord(input)) {
    errors.push(message("INVALID_PARTNER", "Partner input is required.", role, "error"));
    return undefined;
  }

  let bp: ReturnType<typeof normalizeBreakpoint>;
  try {
    bp = normalizeBreakpoint(input.breakpoint);
  } catch (error) {
    const text = String(error);
    errors.push(message(/coordinate system/i.test(text) ? "INVALID_COORDINATE_SYSTEM" : "INVALID_BREAKPOINT", text, role, "error"));
    return undefined;
  }

  let geneQuery: { symbol?: string; id?: string };
  try {
    geneQuery = geneInput(input);
  } catch (error) {
    errors.push(message("INVALID_GENE", String(error), role, "error"));
    return undefined;
  }
  if (input.transcriptId !== undefined && (typeof input.transcriptId !== "string" || !input.transcriptId.trim())) {
    errors.push(message("INVALID_TRANSCRIPT", "Transcript id must be a non-empty string.", role, "error"));
    return undefined;
  }
  if (input.strand !== undefined && input.strand !== "+" && input.strand !== "-") {
    errors.push(message("INVALID_STRAND", "Strand must be + or -.", role, "error"));
    return undefined;
  }

  // Validate the requested chromosome coordinate before doing a gene lookup.
  // A provider may legitimately return no gene for an out-of-range position
  // (for example when its index is chromosome-filtered); checking the
  // chromosome first preserves the more actionable ASSEMBLY_OUT_OF_RANGE
  // contract instead of collapsing that case into GENE_NOT_FOUND.
  let chromosomeInfo: ChromosomeAnnotation | undefined;
  let chromosomeAnnotationUnavailable = false;
  if (provider.getChromosome) {
    try {
      chromosomeInfo = await provider.getChromosome(assembly, bp.chromosome);
    } catch (error) {
      errors.push(message(providerErrorCode(error), String(error), role, "error"));
      return undefined;
    }
    if (!chromosomeInfo) {
      chromosomeAnnotationUnavailable = true;
    } else if (!isValidChromosome(chromosomeInfo)) {
      errors.push(message("MALFORMED_CHROMOSOME_ANNOTATION", `Chromosome ${bp.chromosome} annotation is malformed.`, role, "error"));
      return undefined;
    } else {
      let chromosomeName: string;
      try {
        chromosomeName = normalizeChromosome(chromosomeInfo.name);
      } catch (error) {
        errors.push(message("MALFORMED_CHROMOSOME_ANNOTATION", `Chromosome ${bp.chromosome} annotation has an invalid name: ${String(error)}`, role, "error"));
        return undefined;
      }
      if (chromosomeName !== bp.chromosome) {
        errors.push(message("CHROMOSOME_MISMATCH", `Chromosome annotation ${chromosomeInfo.name} does not match ${bp.chromosome}.`, role, "error"));
        return undefined;
      }
      if (bp.position > chromosomeInfo.length) {
        errors.push(message("ASSEMBLY_OUT_OF_RANGE", `Breakpoint ${bp.chromosome}:${bp.position} exceeds chromosome length ${chromosomeInfo.length}.`, role, "error"));
        return undefined;
      }
    }
  }

  let gene: GeneAnnotation | undefined;
  try {
    gene = await provider.getGene(assembly, {
      ...geneQuery,
      chromosome: bp.chromosome,
    });
  } catch (error) {
    errors.push(message(providerErrorCode(error), String(error), role, "error"));
    return undefined;
  }
  if (!gene) {
    // Providers commonly apply the chromosome filter in their index. Retry
    // without that filter so the resolver can report the actionable
    // CHROMOSOME_MISMATCH contract instead of collapsing it into
    // GENE_NOT_FOUND. This fallback still leaves duplicate-locus disambiguation
    // to the provider whenever a matching chromosome exists.
    try {
      gene = await provider.getGene(assembly, geneQuery);
    } catch (error) {
      errors.push(message(providerErrorCode(error), String(error), role, "error"));
      return undefined;
    }
    if (!gene) {
      errors.push(message("GENE_NOT_FOUND", `No annotation found for ${geneQuery.symbol ?? geneQuery.id}.`, role, "error"));
      return undefined;
    }
  }
  if (!isValidGene(gene)) {
    errors.push(message("MALFORMED_GENE_ANNOTATION", `Annotation for ${geneQuery.symbol ?? geneQuery.id} is malformed.`, role, "error"));
    return undefined;
  }

  let chromosome: string;
  try {
    chromosome = normalizeChromosome(gene.chromosome);
  } catch (error) {
    errors.push(message("MALFORMED_GENE_ANNOTATION", `Annotation chromosome is invalid: ${String(error)}`, role, "error"));
    return undefined;
  }
  if (chromosome !== bp.chromosome) {
    errors.push(message("CHROMOSOME_MISMATCH", `Breakpoint ${bp.chromosome} does not match ${gene.symbol} on ${chromosome}.`, role, "error"));
    return undefined;
  }

  if (chromosomeInfo && gene.end > chromosomeInfo.length) {
    errors.push(message("MALFORMED_GENE_ANNOTATION", `${gene.symbol} extends beyond chromosome ${bp.chromosome} length ${chromosomeInfo.length}.`, role, "error"));
    return undefined;
  }
  if (chromosomeAnnotationUnavailable) {
    // Chromosome metadata is optional on AnnotationProvider. Without a length
    // we cannot prove an assembly-range violation, so preserve the gene
    // resolution and make the missing ideogram data explicit.
    warnings.push(message("CHROMOSOME_ANNOTATION_UNAVAILABLE", `No chromosome length annotation is available for ${bp.chromosome} in assembly ${assembly}.`, role, "warning"));
  }

  if (bp.position < gene.start || bp.position > gene.end) {
    errors.push(message("BREAKPOINT_OUTSIDE_GENE", `Breakpoint ${bp.chromosome}:${bp.position} is outside ${gene.symbol} (${gene.start}-${gene.end}).`, role, "error"));
    return undefined;
  }

  const spanCandidates = gene.transcripts.filter((transcript) => transcript.start <= bp.position && bp.position <= transcript.end);
  const candidates = spanCandidates.filter((transcript) => transcriptWithinGene(gene, transcript));
  let transcript: TranscriptAnnotation | undefined;
  const requestedTranscriptId = input.transcriptId?.trim();
  if (requestedTranscriptId) {
    transcript = gene.transcripts.find((item) => item.id === requestedTranscriptId);
    if (!transcript) {
      errors.push(message("TRANSCRIPT_NOT_FOUND", `Transcript ${requestedTranscriptId} was not found for ${gene.symbol}.`, role, "error"));
      return undefined;
    }
    if (!(transcript.start <= bp.position && bp.position <= transcript.end)) {
      errors.push(message("BREAKPOINT_OUTSIDE_TRANSCRIPT", `Breakpoint is outside selected transcript ${transcript.id}.`, role, "error"));
      return undefined;
    }
    if (transcript.start < gene.start || transcript.end > gene.end || !hasValidTranscriptStructure(transcript)) {
      errors.push(message("MALFORMED_TRANSCRIPT_ANNOTATION", `Transcript ${transcript.id} has invalid exon structure.`, role, "error"));
      return undefined;
    }
  } else {
    // A metadata-preferred transcript without exons cannot produce a plot;
    // prefer the next compatible transcript before reporting a structural
    // annotation error. If all candidates are empty, report that explicitly.
    transcript = [...candidates]
      .filter((item) => item.exons.length > 0
        && hasValidTranscriptStructure(item)
        && breakpointHasTranscriptLocation(item, bp.position))
      .sort(compareRank)[0];
  }
  if (!transcript) {
    if (candidates.length > 0 || spanCandidates.length > 0) {
      const hasMalformed = spanCandidates.some((item) => !transcriptWithinGene(gene, item)
        || (item.exons.length > 0 && !hasValidTranscriptStructure(item)));
      const hasOutside = !hasMalformed && spanCandidates.some((item) => item.exons.length > 0
        && hasValidTranscriptStructure(item)
        && !breakpointHasTranscriptLocation(item, bp.position));
      errors.push(message(
        hasMalformed ? "MALFORMED_TRANSCRIPT_ANNOTATION" : hasOutside ? "BREAKPOINT_OUTSIDE_TRANSCRIPT" : "TRANSCRIPT_HAS_NO_EXONS",
        hasMalformed
          ? `No compatible transcript for ${gene.symbol} has a valid exon structure.`
          : hasOutside
            ? `Breakpoint is outside all exons and introns of compatible transcripts for ${gene.symbol}.`
          : `No compatible transcript for ${gene.symbol} contains drawable exons.`,
        role,
        "error",
      ));
      return undefined;
    }
    errors.push(message("NO_COMPATIBLE_TRANSCRIPT", `No transcript spans breakpoint ${bp.chromosome}:${bp.position}.`, role, "error"));
    return undefined;
  }
  if (transcript.exons.length === 0) {
    errors.push(message("TRANSCRIPT_HAS_NO_EXONS", `Transcript ${transcript.id} has no exons and cannot be drawn.`, role, "error"));
    return undefined;
  }
  if (input.strand && input.strand !== transcript.strand) {
    errors.push(message("STRAND_MISMATCH", `Input strand ${input.strand} does not match transcript ${transcript.id} strand ${transcript.strand}.`, role, "error"));
    return undefined;
  }

  let cytoband: string | undefined;
  if (provider.getCytoband) {
    try {
      const resolvedCytoband = await provider.getCytoband(assembly, bp.chromosome, bp.position);
      if (resolvedCytoband !== undefined && (typeof resolvedCytoband !== "string" || !resolvedCytoband.trim())) {
        warnings.push(message("MALFORMED_CYTOBAND", "Cytoband annotation is not a non-empty string and was ignored.", role, "warning"));
      } else if (resolvedCytoband === undefined && chromosomeInfo?.bands) {
        cytoband = chromosomeInfo.bands.find((band) => bp.position >= band.start && bp.position <= band.end)?.name;
      } else {
        cytoband = resolvedCytoband;
      }
    } catch (error) {
      warnings.push(message("CYTOBAND_LOOKUP_FAILED", String(error), role, "warning"));
    }
  } else if (chromosomeInfo?.bands) {
    // Providers may expose chromosome bands but omit a dedicated cytoband
    // method. Derive the label locally without introducing any annotation
    // lookup into the renderer.
    cytoband = chromosomeInfo.bands.find((band) => bp.position >= band.start && bp.position <= band.end)?.name;
  }
  const resolution = resolveLocation(transcript, bp.position, bp.chromosome, cytoband);
  if (resolution.region === "outside") {
    // This can only occur for malformed annotation spans, but never silently
    // turn it into a biological conclusion.
    errors.push(message("BREAKPOINT_OUTSIDE_TRANSCRIPT", `Breakpoint is outside all exons of selected transcript ${transcript.id}.`, role, "error"));
    return undefined;
  }
  const fullExons = [...transcript.exons]
    .sort((a, b) => a.start - b.start || a.end - b.end || a.exonNumber - b.exonNumber)
    .map((exon) => plotExon(exon));
  const availableTranscripts = [...candidates]
    .filter((item) => item.exons.length > 0 && hasValidTranscriptStructure(item) && breakpointHasTranscriptLocation(item, bp.position))
    .sort(compareRank)
    .map((item) => ({ id: item.id, displayName: item.displayName }));
  return {
    transcript,
    partner: {
      gene: { id: gene.id, symbol: gene.symbol, displayName: gene.displayName },
      chromosome: bp.chromosome,
      breakpoint: bp.position,
      strand: transcript.strand,
      transcript: { id: transcript.id, displayName: transcript.displayName, exons: fullExons },
      availableTranscripts,
      resolution,
      cytoband,
      chromosomeLength: chromosomeInfo?.length,
      chromosomeBands: chromosomeInfo?.bands?.map((band) => ({ ...band })),
    },
  };
}

export async function resolveFusion(input: FusionInput, provider: AnnotationProvider): Promise<ResolutionResult<FusionPlotSpec>> {
  const warnings: ResolutionMessage[] = [];
  const errors: ResolutionMessage[] = [];
  if (!isRecord(input)) {
    return { warnings, errors: [message("INVALID_INPUT", "Fusion input is required.", undefined, "error")] };
  }
  if (!provider || typeof provider.getGene !== "function"
    || (provider.getChromosome !== undefined && typeof provider.getChromosome !== "function")
    || (provider.getCytoband !== undefined && typeof provider.getCytoband !== "function")
    || (provider.getMetadata !== undefined && typeof provider.getMetadata !== "function")) {
    return { warnings, errors: [message("INVALID_ANNOTATION_PROVIDER", "An annotation provider with getGene is required.", undefined, "error")] };
  }
  let assembly: Assembly;
  if (!input.assembly || typeof input.assembly !== "string" || !input.assembly.trim()) {
    return { warnings, errors: [message("INVALID_ASSEMBLY", "Assembly is required.", undefined, "error")] };
  }
  if (input.specVersion !== undefined && input.specVersion !== "0.1") {
    return { warnings, errors: [message("UNSUPPORTED_SPEC_VERSION", `Unsupported specVersion: ${String(input.specVersion)}.`, undefined, "error")] };
  }
  if (input.coordinateSystem !== undefined && input.coordinateSystem !== "1-based-inclusive") {
    return { warnings, errors: [message("INVALID_COORDINATE_SYSTEM", `Unsupported coordinate system: ${String(input.coordinateSystem)}.`, undefined, "error")] };
  }
  if (input.locale !== undefined && input.locale !== "en" && input.locale !== "zh-CN") {
    return { warnings, errors: [message("INVALID_LOCALE", `Unsupported locale: ${String(input.locale)}.`, undefined, "error")] };
  }
  try {
    assembly = normalizeAssembly(input.assembly);
  } catch (error) {
    return { warnings, errors: [message("INVALID_ASSEMBLY", String(error), undefined, "error")] };
  }

  const five = await resolvePartner(assembly, input.fivePrime, "fivePrime", provider, warnings, errors);
  const three = await resolvePartner(assembly, input.threePrime, "threePrime", provider, warnings, errors);
  // Errors are terminal for Automatic mode. Callers can still use their raw
  // FusionInput to create a manual seed, but must not mistake partial data for
  // a biologically resolved fusion.
  if (errors.length > 0 || !five || !three) return { warnings, errors };

  const provenance: NonNullable<FusionPlotSpec["provenance"]> = { source: "FusionDraw annotation resolver" };
  if (provider.getMetadata) {
    try {
      const metadata = await provider.getMetadata(assembly);
      if (metadata && typeof metadata === "object") {
        if (typeof metadata.source === "string" && metadata.source.trim()) provenance.source = metadata.source;
        if (typeof metadata.annotationVersion === "string" && metadata.annotationVersion.trim()) provenance.annotationVersion = metadata.annotationVersion;
        if (typeof metadata.checksum === "string" && metadata.checksum.trim()) provenance.annotationChecksum = metadata.checksum;
      }
    } catch (error) {
      warnings.push(message("ANNOTATION_METADATA_UNAVAILABLE", String(error), undefined, "warning"));
    }
  }

  const spec: FusionPlotSpec = {
    specVersion: "0.1",
    assembly,
    coordinateSystem: "1-based-inclusive",
    locale: input.locale ?? "en",
    fivePrime: five.partner,
    threePrime: three.partner,
    fusion: {
      name: `${five.partner.gene.symbol}::${three.partner.gene.symbol}`,
      fivePrimeExons: retainedExons(five.transcript, five.partner.breakpoint!, "fivePrime"),
      threePrimeExons: retainedExons(three.transcript, three.partner.breakpoint!, "threePrime"),
    },
    chromosomeView: { show: true, showCytoband: true },
    geneView: { layout: "schematic", visibleExonsBefore: 8, visibleExonsAfter: 8 },
    provenance,
  };
  return { data: spec, warnings, errors };
}

export function createManualPartner(partial: Partial<PlotPartner> & { symbol: string }): PlotPartner {
  const { symbol, ...rest } = partial;
  const gene = partial.gene ?? {};
  return {
    ...rest,
    // The explicit helper argument is authoritative. This prevents an
    // accidental `partial.gene.symbol` value from producing a partner whose
    // display name and fusion name disagree.
    gene: { ...gene, symbol: symbol.trim() },
    transcript: partial.transcript ?? { exons: [] },
    manual: true,
  };
}
