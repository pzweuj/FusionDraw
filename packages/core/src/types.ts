export type Assembly = "hg19" | "hg38" | (string & {});
export type Strand = "+" | "-";
export type CoordinateSystem = "1-based-inclusive";
export type ExonType = "coding" | "utr" | "unknown";
export type BreakpointRegion = "exon" | "intron" | "outside";
export type CodingRegion = "cds" | "utr" | "noncoding" | "unknown";

export interface BreakpointInput {
  chromosome: string;
  /** 1-based inclusive genomic base. */
  position: number;
  coordinateSystem?: CoordinateSystem;
}

export interface GeneInput {
  symbol: string;
  id?: string;
  displayName?: string;
}

export interface PartnerInput {
  gene: string | GeneInput;
  breakpoint: BreakpointInput;
  transcriptId?: string;
  strand?: Strand;
}

export interface FusionInput {
  specVersion?: "0.1";
  assembly: Assembly;
  /** Input coordinates are always 1-based inclusive; optional for legacy callers. */
  coordinateSystem?: CoordinateSystem;
  fivePrime: PartnerInput;
  threePrime: PartnerInput;
  locale?: Locale;
}

export interface ExonAnnotation {
  id?: string;
  start: number;
  end: number;
  exonNumber: number;
  cdsStart?: number;
  cdsEnd?: number;
}

export interface TranscriptAnnotation {
  id: string;
  displayName?: string;
  start: number;
  end: number;
  strand: Strand;
  biotype?: string;
  canonical?: boolean;
  maneSelect?: boolean;
  manePlusClinical?: boolean;
  appris?: string;
  ccds?: boolean;
  cdsLength?: number;
  exons: ExonAnnotation[];
}

export interface GeneAnnotation {
  id: string;
  symbol: string;
  displayName?: string;
  chromosome: string;
  start: number;
  end: number;
  strand: Strand;
  transcripts: TranscriptAnnotation[];
}

export interface Cytoband {
  name: string;
  start: number;
  end: number;
  stain?: string;
}

export interface ChromosomeAnnotation {
  name: string;
  length: number;
  bands?: Cytoband[];
}

export interface BreakpointResolution {
  transcriptId: string;
  chromosome: string;
  position: number;
  strand: Strand;
  region: BreakpointRegion;
  codingRegion: CodingRegion;
  exonNumber?: number;
  /** 1-based offset measured in transcript direction. */
  exonOffset?: number;
  intronNumber?: number;
  /** When the breakpoint lies inside an exon, this flag distinguishes between
   * the exterior edge (boundary, the default) and the interior (mid‑exon). */
  breakpointLocation?: "boundary" | "interior";
  cytoband?: string;
}

export interface PlotExon {
  id?: string;
  /** Base annotation label; `visual.label` can override it without changing annotation. */
  label: string;
  /** Base biological values from annotation (kept for compact/manual specs). */
  genomicStart?: number;
  genomicEnd?: number;
  width?: number;
  type?: ExonType;
  breakpoint?: boolean;
  visible?: boolean;
  biological?: PlotExonBiologicalOverride;
  visual?: PlotExonVisualOverride;
}

export interface PlotTranscript {
  id?: string;
  displayName?: string;
  exons: PlotExon[];
}

/** Biological edits are kept separate from visual-only edits in the editor. */
export interface PlotExonBiologicalOverride {
  genomicStart?: number;
  genomicEnd?: number;
  type?: ExonType;
  breakpoint?: boolean;
}

export interface PlotExonVisualOverride {
  label?: string;
  width?: number;
  visible?: boolean;
}

export interface PlotPartner {
  gene: { id?: string; symbol: string; displayName?: string };
  chromosome?: string;
  breakpoint?: number;
  strand?: Strand;
  transcript: PlotTranscript;
  availableTranscripts?: { id: string; displayName?: string }[];
  resolution?: BreakpointResolution;
  cytoband?: string;
  chromosomeLength?: number;
  chromosomeBands?: Cytoband[];
  manual?: boolean;
  /** Optional bases rendered on the corresponding side of the fused transcript. */
  baseSequence?: string;
  /** Render the exon number above every exon of the source gene. When false
   * (default), crowded gene tracks only label the first, last and breakpoint
   * exons. */
  showAllExonLabels?: boolean;
}

/** Backwards-compatible public name for a resolved fusion partner. */
export type FusionPartner = PlotPartner;

export interface FusionStructure {
  name: string;
  /** Transcript-oriented retained segments; source transcript exons are not reused. */
  fivePrimeExons: PlotExon[];
  threePrimeExons: PlotExon[];
}

export type Locale = "en" | "zh-CN";

export interface ChromosomeViewOptions {
  show?: boolean;
  showCytoband?: boolean;
}

export interface GeneViewOptions {
  layout?: "schematic" | "genomic";
  visibleExonsBefore?: number;
  visibleExonsAfter?: number;
}

export interface PlotStyle {
  primaryColor?: string;
  secondaryColor?: string;
  breakpointColor?: string;
  fontFamily?: string;
  fontSize?: number;
}

export interface FusionPlotSpec {
  specVersion: "0.1";
  assembly?: Assembly;
  coordinateSystem: CoordinateSystem;
  locale: Locale;
  fivePrime: PlotPartner;
  threePrime: PlotPartner;
  fusion: FusionStructure;
  chromosomeView?: ChromosomeViewOptions;
  geneView?: GeneViewOptions;
  style?: PlotStyle;
  provenance?: { source?: string; annotationVersion?: string; annotationChecksum?: string; generatedAt?: string };
}

export interface ResolutionMessage {
  code: string;
  message: string;
  partner?: "fivePrime" | "threePrime";
  severity: "warning" | "error";
}

export interface ResolutionResult<T> {
  data?: T;
  warnings: ResolutionMessage[];
  errors: ResolutionMessage[];
}

export type MaybePromise<T> = T | Promise<T>;

export interface AnnotationProvider {
  /**
   * Resolve a gene within an assembly.  Chromosome is optional for backwards
   * compatibility, but resolvers should provide it whenever the user supplied
   * a breakpoint so duplicate symbols on different loci are not ambiguous.
   */
  getGene(assembly: Assembly, query: { symbol?: string; id?: string; chromosome?: string }): MaybePromise<GeneAnnotation | undefined>;
  getChromosome?(assembly: Assembly, chromosome: string): MaybePromise<ChromosomeAnnotation | undefined>;
  getCytoband?(assembly: Assembly, chromosome: string, position: number): MaybePromise<string | undefined>;
  /** Optional pinned release metadata used to populate PlotSpec provenance. */
  getMetadata?(assembly: Assembly): MaybePromise<AnnotationProviderMetadata | undefined>;
}

export interface AnnotationProviderMetadata {
  source?: string;
  annotationVersion?: string;
  checksum?: string;
}
