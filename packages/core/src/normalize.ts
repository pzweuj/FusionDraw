import type { Assembly, BreakpointInput, Strand } from "./types.js";

export function normalizeChromosome(chromosome: string): string {
  if (typeof chromosome !== "string" || !chromosome.trim()) throw new Error("Chromosome is required.");
  const raw = chromosome.trim().replace(/^chr/i, "");
  if (!raw) throw new Error("Chromosome is required.");
  if (/^m$/i.test(raw) || /^mt$/i.test(raw)) return "chrM";
  return `chr${raw}`;
}

export function normalizeBreakpoint(input: BreakpointInput): BreakpointInput {
  if (!input || typeof input !== "object") throw new Error("Breakpoint is required.");
  if (input.coordinateSystem !== undefined && input.coordinateSystem !== "1-based-inclusive") {
    throw new Error(`Unsupported coordinate system: ${input.coordinateSystem}.`);
  }
  if (!Number.isSafeInteger(input.position) || input.position < 1) {
    throw new Error("Breakpoint position must be a positive integer.");
  }
  return { ...input, chromosome: normalizeChromosome(input.chromosome), coordinateSystem: "1-based-inclusive" };
}

export function normalizeAssembly(assembly: Assembly): Assembly {
  if (typeof assembly !== "string" || !assembly.trim()) throw new Error("Assembly is required.");
  const normalized = assembly.trim().toLowerCase().replace(/^grch/, "hg");
  // Version suffixes are release metadata, not a distinct coordinate system:
  // hg19.p13 and GRCh37.p13 both map to the canonical hg19 key.
  if (normalized === "37" || /^37\./.test(normalized) || normalized === "hg37" || /^hg37\./.test(normalized)
    || normalized === "hg19" || /^hg19\./.test(normalized)) return "hg19";
  if (normalized === "38" || /^38\./.test(normalized) || normalized === "hg38" || /^hg38\./.test(normalized)) return "hg38";
  return normalized as Assembly;
}

export function transcriptDirection(strand: Strand, role: "fivePrime" | "threePrime"): "left" | "right" {
  const fiveIsLeft = strand === "+" ? role === "fivePrime" : role === "threePrime";
  return fiveIsLeft ? "left" : "right";
}
