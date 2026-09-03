import type { FusionPlotSpec } from "./types";
import { normalizeChromosome } from "./normalize";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFinitePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && Number.isFinite(value) && value >= 1;
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateCytoband(band: unknown, path: string, errors: string[]): void {
  if (!isRecord(band)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (typeof band.name !== "string" || !band.name.trim()) errors.push(`${path}.name must be a non-empty string.`);
  if (!isFinitePositiveInteger(band.start)) errors.push(`${path}.start must be a positive integer.`);
  if (!isFinitePositiveInteger(band.end)) errors.push(`${path}.end must be a positive integer.`);
  if (isFinitePositiveInteger(band.start) && isFinitePositiveInteger(band.end) && band.start > band.end) {
    errors.push(`${path}.start must be <= end.`);
  }
  if (band.stain !== undefined && typeof band.stain !== "string") errors.push(`${path}.stain must be a string.`);
}

function validateExon(exon: unknown, path: string, errors: string[]): void {
  if (!isRecord(exon)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (typeof exon.label !== "string") {
    errors.push(`${path}.label must be a string.`);
  } else if (!exon.label.trim()) {
    errors.push(`${path}.label must not be empty.`);
  }
  if (exon.id !== undefined && !isNonEmptyString(exon.id)) errors.push(`${path}.id must be a non-empty string.`);
  if (exon.width !== undefined && !isFinitePositiveNumber(exon.width)) {
    errors.push(`${path}.width must be a positive finite number.`);
  }
  if (exon.type !== undefined && !["coding", "utr", "unknown"].includes(exon.type as string)) {
    errors.push(`${path}.type must be coding, utr, or unknown.`);
  }
  if (exon.visible !== undefined && typeof exon.visible !== "boolean") {
    errors.push(`${path}.visible must be a boolean.`);
  }
  if (exon.breakpoint !== undefined && typeof exon.breakpoint !== "boolean") {
    errors.push(`${path}.breakpoint must be a boolean.`);
  }
  const hasStart = exon.genomicStart !== undefined;
  const hasEnd = exon.genomicEnd !== undefined;
  if (hasStart !== hasEnd) {
    errors.push(`${path} must provide both genomicStart and genomicEnd, or neither.`);
  }
  if (hasStart && !isFinitePositiveInteger(exon.genomicStart)) {
    errors.push(`${path}.genomicStart must be a positive integer.`);
  }
  if (hasEnd && !isFinitePositiveInteger(exon.genomicEnd)) {
    errors.push(`${path}.genomicEnd must be a positive integer.`);
  }
  if (isFinitePositiveInteger(exon.genomicStart)
    && isFinitePositiveInteger(exon.genomicEnd)
    && exon.genomicStart > exon.genomicEnd) {
    errors.push(`${path}.genomicStart must be <= genomicEnd.`);
  }
  if (exon.biological !== undefined) {
    if (!isRecord(exon.biological)) errors.push(`${path}.biological must be an object.`);
    else {
      const biological = exon.biological;
      const biologicalHasStart = biological.genomicStart !== undefined;
      const biologicalHasEnd = biological.genomicEnd !== undefined;
      if (biologicalHasStart !== biologicalHasEnd) errors.push(`${path}.biological must provide both genomicStart and genomicEnd, or neither.`);
      if (biologicalHasStart && !isFinitePositiveInteger(biological.genomicStart)) errors.push(`${path}.biological.genomicStart must be a positive integer.`);
      if (biologicalHasEnd && !isFinitePositiveInteger(biological.genomicEnd)) errors.push(`${path}.biological.genomicEnd must be a positive integer.`);
      if (isFinitePositiveInteger(biological.genomicStart) && isFinitePositiveInteger(biological.genomicEnd) && biological.genomicStart > biological.genomicEnd) errors.push(`${path}.biological.genomicStart must be <= genomicEnd.`);
      if (biological.type !== undefined && !["coding", "utr", "unknown"].includes(biological.type as string)) errors.push(`${path}.biological.type is invalid.`);
      if (biological.breakpoint !== undefined && typeof biological.breakpoint !== "boolean") errors.push(`${path}.biological.breakpoint must be a boolean.`);
    }
  }
  if (exon.visual !== undefined) {
    if (!isRecord(exon.visual)) errors.push(`${path}.visual must be an object.`);
    else {
      const visual = exon.visual;
      if (visual.label !== undefined && (typeof visual.label !== "string" || !visual.label.trim())) errors.push(`${path}.visual.label must be a non-empty string.`);
      if (visual.width !== undefined && !isFinitePositiveNumber(visual.width)) errors.push(`${path}.visual.width must be a positive finite number.`);
      if (visual.visible !== undefined && typeof visual.visible !== "boolean") errors.push(`${path}.visual.visible must be a boolean.`);
    }
  }
}

function effectiveExonCoordinates(exon: RecordValue): { start: number; end: number } | undefined {
  const biological = isRecord(exon.biological) ? exon.biological : undefined;
  const start = biological && isFinitePositiveInteger(biological.genomicStart)
    ? biological.genomicStart
    : exon.genomicStart;
  const end = biological && isFinitePositiveInteger(biological.genomicEnd)
    ? biological.genomicEnd
    : exon.genomicEnd;
  return isFinitePositiveInteger(start) && isFinitePositiveInteger(end) && start <= end
    ? { start, end }
    : undefined;
}

function validateExonCoordinateBounds(exon: unknown, path: string, chromosomeLength: unknown, errors: string[]): void {
  if (!isFinitePositiveInteger(chromosomeLength)) return;
  if (!isRecord(exon)) return;
  const coordinates = effectiveExonCoordinates(exon);
  if (coordinates && coordinates.end > chromosomeLength) {
    errors.push(`${path}.genomicEnd must not exceed chromosomeLength.`);
  }
}

function validateResolution(resolution: unknown, path: string, errors: string[]): void {
  if (resolution === undefined) return;
  if (!isRecord(resolution)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (typeof resolution.transcriptId !== "string" || !resolution.transcriptId.trim()) errors.push(`${path}.transcriptId must be a non-empty string.`);
  if (typeof resolution.chromosome !== "string" || !resolution.chromosome.trim()) errors.push(`${path}.chromosome must be a non-empty string.`);
  if (!isFinitePositiveInteger(resolution.position)) errors.push(`${path}.position must be a positive integer.`);
  if (resolution.strand !== "+" && resolution.strand !== "-") errors.push(`${path}.strand must be + or -.`);
  if (!["exon", "intron", "outside"].includes(resolution.region as string)) errors.push(`${path}.region is invalid.`);
  if (!["cds", "utr", "noncoding", "unknown"].includes(resolution.codingRegion as string)) errors.push(`${path}.codingRegion is invalid.`);
  if (resolution.exonNumber !== undefined && !isFinitePositiveInteger(resolution.exonNumber)) errors.push(`${path}.exonNumber must be a positive integer.`);
  if (resolution.exonOffset !== undefined && !isFinitePositiveInteger(resolution.exonOffset)) errors.push(`${path}.exonOffset must be a positive integer.`);
  if (resolution.intronNumber !== undefined && !isFinitePositiveInteger(resolution.intronNumber)) errors.push(`${path}.intronNumber must be a positive integer.`);
  if (resolution.breakpointLocation !== undefined && !["boundary", "interior"].includes(resolution.breakpointLocation as string)) errors.push(`${path}.breakpointLocation is invalid.`);
  if (resolution.breakpointLocation !== undefined && resolution.region !== "exon") errors.push(`${path}.breakpointLocation is only valid for an exon resolution.`);
  if (resolution.cytoband !== undefined && !isNonEmptyString(resolution.cytoband)) errors.push(`${path}.cytoband must be a non-empty string.`);
  if (resolution.region === "exon" && !isFinitePositiveInteger(resolution.exonNumber)) errors.push(`${path}.exonNumber is required for an exon resolution.`);
  if (resolution.region === "intron" && !isFinitePositiveInteger(resolution.intronNumber)) errors.push(`${path}.intronNumber is required for an intron resolution.`);
  if (resolution.exonOffset !== undefined && !isFinitePositiveInteger(resolution.exonNumber)) errors.push(`${path}.exonNumber is required when exonOffset is present.`);
}

function validatePartner(partner: unknown, path: string, errors: string[]): void {
  if (!isRecord(partner)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  const gene = partner.gene;
  if (!isRecord(gene)) {
    errors.push(`${path}.gene is required.`);
  } else {
    if (typeof gene.symbol !== "string" || !gene.symbol.trim()) errors.push(`${path}.gene.symbol is required.`);
    if (gene.id !== undefined && (typeof gene.id !== "string" || !gene.id.trim())) errors.push(`${path}.gene.id must be a non-empty string.`);
    if (gene.displayName !== undefined && typeof gene.displayName !== "string") errors.push(`${path}.gene.displayName must be a string.`);
  }
  if (partner.chromosome !== undefined && (typeof partner.chromosome !== "string" || !partner.chromosome.trim())) errors.push(`${path}.chromosome must be a non-empty string.`);
  if (partner.breakpoint !== undefined && !isFinitePositiveInteger(partner.breakpoint)) errors.push(`${path}.breakpoint must be a positive integer.`);
  if (partner.strand !== undefined && partner.strand !== "+" && partner.strand !== "-") errors.push(`${path}.strand must be + or -.`);
  if (partner.cytoband !== undefined && (typeof partner.cytoband !== "string" || !partner.cytoband.trim())) errors.push(`${path}.cytoband must be a non-empty string.`);
  if (partner.chromosomeLength !== undefined && !isFinitePositiveInteger(partner.chromosomeLength)) errors.push(`${path}.chromosomeLength must be a positive integer.`);
  if (isFinitePositiveInteger(partner.breakpoint)
    && isFinitePositiveInteger(partner.chromosomeLength)
    && partner.breakpoint > partner.chromosomeLength) {
    errors.push(`${path}.breakpoint must not exceed chromosomeLength.`);
  }
  if (partner.chromosomeBands !== undefined) {
    if (!Array.isArray(partner.chromosomeBands)) errors.push(`${path}.chromosomeBands must be an array.`);
    else {
      let previousEnd = 0;
      partner.chromosomeBands.forEach((band, index) => {
        validateCytoband(band, `${path}.chromosomeBands[${index}]`, errors);
        if (isFinitePositiveInteger(partner.chromosomeLength) && isRecord(band)
          && isFinitePositiveInteger(band.end) && band.end > partner.chromosomeLength) {
          errors.push(`${path}.chromosomeBands[${index}].end must not exceed chromosomeLength.`);
        }
        if (isRecord(band) && isFinitePositiveInteger(band.start) && isFinitePositiveInteger(band.end)) {
          if (band.start <= previousEnd) errors.push(`${path}.chromosomeBands must be sorted and non-overlapping.`);
          previousEnd = Math.max(previousEnd, band.end);
        }
      });
    }
  }
  const transcript = partner.transcript;
  if (!isRecord(transcript)) {
    errors.push(`${path}.transcript is required.`);
  } else {
    if (transcript.id !== undefined && (typeof transcript.id !== "string" || !transcript.id.trim())) errors.push(`${path}.transcript.id must be a non-empty string.`);
    if (transcript.displayName !== undefined && typeof transcript.displayName !== "string") errors.push(`${path}.transcript.displayName must be a string.`);
    if (!Array.isArray(transcript.exons)) {
      errors.push(`${path}.transcript.exons is required.`);
    } else {
      transcript.exons.forEach((exon, index) => {
        const exonPath = `${path}.transcript.exons[${index}]`;
        validateExon(exon, exonPath, errors);
        validateExonCoordinateBounds(exon, exonPath, partner.chromosomeLength, errors);
      });
    }
  }
  if (partner.availableTranscripts !== undefined) {
    if (!Array.isArray(partner.availableTranscripts)) errors.push(`${path}.availableTranscripts must be an array.`);
    else {
      const transcriptIds = new Set<string>();
      partner.availableTranscripts.forEach((item, index) => {
      if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) errors.push(`${path}.availableTranscripts[${index}].id must be a non-empty string.`);
      if (isRecord(item) && item.displayName !== undefined && typeof item.displayName !== "string") errors.push(`${path}.availableTranscripts[${index}].displayName must be a string.`);
        if (isRecord(item) && typeof item.id === "string" && item.id.trim()) {
          const id = item.id.trim();
          if (transcriptIds.has(id)) errors.push(`${path}.availableTranscripts contains duplicate transcript id ${id}.`);
          transcriptIds.add(id);
        }
      });
    }
  }
  if (partner.manual !== undefined && typeof partner.manual !== "boolean") errors.push(`${path}.manual must be a boolean.`);
  if (partner.baseSequence !== undefined && typeof partner.baseSequence !== "string") errors.push(`${path}.baseSequence must be a string.`);
  validateResolution(partner.resolution, `${path}.resolution`, errors);
  if (isRecord(partner.resolution)
    && isFinitePositiveInteger(partner.resolution.position)
    && isFinitePositiveInteger(partner.chromosomeLength)
    && partner.resolution.position > partner.chromosomeLength) {
    errors.push(`${path}.resolution.position must not exceed chromosomeLength.`);
  }
  if (isRecord(partner.resolution)) {
    if (isRecord(transcript)
      && typeof transcript.id === "string"
      && transcript.id.trim()
      && typeof partner.resolution.transcriptId === "string"
      && partner.resolution.transcriptId.trim()
      && transcript.id !== partner.resolution.transcriptId) {
      errors.push(`${path}.resolution.transcriptId must match transcript.id.`);
    }
    if (typeof partner.breakpoint === "number"
      && Number.isSafeInteger(partner.breakpoint)
      && typeof partner.resolution.position === "number"
      && Number.isSafeInteger(partner.resolution.position)
      && partner.breakpoint !== partner.resolution.position) {
      errors.push(`${path}.resolution.position must match breakpoint.`);
    }
    if (typeof partner.chromosome === "string" && typeof partner.resolution.chromosome === "string") {
      try {
        if (normalizeChromosome(partner.chromosome) !== normalizeChromosome(partner.resolution.chromosome)) {
          errors.push(`${path}.resolution.chromosome must match chromosome.`);
        }
      } catch {
        // The individual chromosome fields already receive their own shape
        // errors; avoid adding a duplicate normalization diagnostic here.
      }
    }
    if ((partner.strand === "+" || partner.strand === "-")
      && (partner.resolution.strand === "+" || partner.resolution.strand === "-")
      && partner.strand !== partner.resolution.strand) {
      errors.push(`${path}.resolution.strand must match strand.`);
    }

    // When source exon coordinates are available, cross-check the declared
    // region/number/offset instead of allowing imported JSON to claim a
    // biological location that contradicts its own transcript model. Purely
    // manual, coordinate-free specs intentionally skip this check.
    if (isRecord(transcript) && Array.isArray(transcript.exons)) {
      const coordinateExons = transcript.exons
        .filter(isRecord)
        .map((exon) => ({ exon, coordinates: effectiveExonCoordinates(exon) }))
        .filter((item): item is { exon: RecordValue; coordinates: { start: number; end: number } } => item.coordinates !== undefined)
        .map(({ exon, coordinates }) => ({
          start: coordinates.start,
          end: coordinates.end,
          number: typeof exon.label === "string" && exon.label.trim() && /^\d+$/.test(exon.label.trim())
            ? Number(exon.label.trim())
            : undefined,
        }))
        .sort((a, b) => a.start - b.start || a.end - b.end);
      const position = isFinitePositiveInteger(partner.resolution.position)
        ? partner.resolution.position
        : undefined;
      if (coordinateExons.length > 0 && position !== undefined) {
        const exonIndex = coordinateExons.findIndex((exon) => position >= exon.start && position <= exon.end);
        if (partner.resolution.region === "exon") {
          if (exonIndex < 0) {
            errors.push(`${path}.resolution.region must identify an exon containing resolution.position.`);
          } else {
            const exon = coordinateExons[exonIndex];
            if (partner.resolution.exonNumber !== undefined && exon.number !== undefined
              && partner.resolution.exonNumber !== exon.number) {
              errors.push(`${path}.resolution.exonNumber does not match the containing exon.`);
            }
            if (partner.resolution.exonOffset !== undefined) {
              const expectedOffset = partner.resolution.strand === "-"
                ? exon.end - position + 1
                : position - exon.start + 1;
              if (partner.resolution.exonOffset !== expectedOffset) {
                errors.push(`${path}.resolution.exonOffset does not match the containing exon.`);
              }
            }
          }
        } else if (partner.resolution.region === "intron") {
          const intronIndex = coordinateExons.findIndex((exon, index) => {
            const next = coordinateExons[index + 1];
            return next !== undefined && position > exon.end && position < next.start;
          });
          if (intronIndex < 0) {
            errors.push(`${path}.resolution.region must identify an intron between transcript exons.`);
          } else if (partner.resolution.intronNumber !== undefined) {
            const left = coordinateExons[intronIndex];
            const right = coordinateExons[intronIndex + 1];
            const expectedNumber = partner.resolution.strand === "-" ? right.number : left.number;
            if (expectedNumber !== undefined && partner.resolution.intronNumber !== expectedNumber) {
              errors.push(`${path}.resolution.intronNumber does not match the transcript exons.`);
            }
          }
        }
      }
    }
  }
}

export function validatePlotSpec(spec: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(spec)) return ["PlotSpec must be an object."];
  if (spec.specVersion !== "0.1") errors.push("Unsupported specVersion.");
  if (spec.coordinateSystem !== "1-based-inclusive") errors.push("coordinateSystem must be 1-based-inclusive.");
  if (spec.locale !== "en" && spec.locale !== "zh-CN") errors.push("locale must be en or zh-CN.");
  if (spec.assembly !== undefined && (typeof spec.assembly !== "string" || !spec.assembly.trim())) errors.push("assembly must be a non-empty string when provided.");
  validatePartner(spec.fivePrime, "fivePrime", errors);
  validatePartner(spec.threePrime, "threePrime", errors);

  if (!isRecord(spec.fusion)) {
    errors.push("fusion is required.");
  } else {
    if (typeof spec.fusion.name !== "string" || !spec.fusion.name.trim()) errors.push("fusion.name must be a non-empty string.");
    if (!Array.isArray(spec.fusion.fivePrimeExons)) errors.push("fusion.fivePrimeExons is required.");
    else spec.fusion.fivePrimeExons.forEach((exon, index) => {
      const exonPath = `fusion.fivePrimeExons[${index}]`;
      validateExon(exon, exonPath, errors);
      validateExonCoordinateBounds(exon, exonPath, isRecord(spec.fivePrime) ? spec.fivePrime.chromosomeLength : undefined, errors);
    });
    if (!Array.isArray(spec.fusion.threePrimeExons)) errors.push("fusion.threePrimeExons is required.");
    else spec.fusion.threePrimeExons.forEach((exon, index) => {
      const exonPath = `fusion.threePrimeExons[${index}]`;
      validateExon(exon, exonPath, errors);
      validateExonCoordinateBounds(exon, exonPath, isRecord(spec.threePrime) ? spec.threePrime.chromosomeLength : undefined, errors);
    });
    if (Array.isArray(spec.fusion.fivePrimeExons) && Array.isArray(spec.fusion.threePrimeExons)
      && spec.fusion.fivePrimeExons.length === 0 && spec.fusion.threePrimeExons.length === 0) {
      errors.push("fusion must contain at least one exon segment.");
    }
    if (Array.isArray(spec.fusion.fivePrimeExons) && Array.isArray(spec.fusion.threePrimeExons)) {
      const hasVisibleSegment = [...spec.fusion.fivePrimeExons, ...spec.fusion.threePrimeExons]
        .some((exon) => isRecord(exon) && exon.visible !== false && (!isRecord(exon.visual) || exon.visual.visible !== false));
      if (!hasVisibleSegment) errors.push("fusion must contain at least one visible exon segment.");
    }
  }

  if (isRecord(spec.chromosomeView)) {
    if (spec.chromosomeView.show !== undefined && typeof spec.chromosomeView.show !== "boolean") errors.push("chromosomeView.show must be a boolean.");
    if (spec.chromosomeView.showCytoband !== undefined && typeof spec.chromosomeView.showCytoband !== "boolean") errors.push("chromosomeView.showCytoband must be a boolean.");
  } else if (spec.chromosomeView !== undefined) errors.push("chromosomeView must be an object.");
  if (isRecord(spec.geneView)) {
    if (spec.geneView.layout !== undefined && spec.geneView.layout !== "schematic" && spec.geneView.layout !== "genomic") errors.push("geneView.layout is invalid.");
    for (const key of ["visibleExonsBefore", "visibleExonsAfter"] as const) {
      if (spec.geneView[key] !== undefined && (typeof spec.geneView[key] !== "number" || !Number.isSafeInteger(spec.geneView[key]) || spec.geneView[key] < 0)) errors.push(`geneView.${key} must be a non-negative integer.`);
    }
  } else if (spec.geneView !== undefined) errors.push("geneView must be an object.");
  if (isRecord(spec.style)) {
    for (const key of ["primaryColor", "secondaryColor", "breakpointColor", "fontFamily"] as const) {
      if (spec.style[key] !== undefined && (typeof spec.style[key] !== "string" || !spec.style[key].trim())) errors.push(`style.${key} must be a non-empty string.`);
    }
    if (spec.style.fontSize !== undefined && !isFinitePositiveNumber(spec.style.fontSize)) errors.push("style.fontSize must be a positive number.");
  } else if (spec.style !== undefined) errors.push("style must be an object.");

  if (spec.provenance !== undefined) {
    if (!isRecord(spec.provenance)) errors.push("provenance must be an object.");
    else {
      for (const key of ["source", "annotationVersion", "annotationChecksum", "generatedAt"] as const) {
        if (spec.provenance[key] !== undefined && typeof spec.provenance[key] !== "string") {
          errors.push(`provenance.${key} must be a string.`);
        }
      }
    }
  }

  return errors;
}

export function isValidPlotSpec(spec: unknown): spec is FusionPlotSpec {
  return validatePlotSpec(spec).length === 0;
}
