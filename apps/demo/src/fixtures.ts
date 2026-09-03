import type { AnnotationProvider, Assembly, ChromosomeAnnotation, GeneAnnotation } from "@fusionview/core";
import { MemoryAnnotationProvider, StaticAnnotationProvider } from "@fusionview/annotation";

const transcript = (id: string, strand: "+" | "-", start: number, end: number, count: number, flags: Partial<{ maneSelect: boolean; canonical: boolean; appris: string }> = {}) => ({
  id, start, end, strand, maneSelect: flags.maneSelect, canonical: flags.canonical, appris: flags.appris,
  cdsLength: count * 800, exons: Array.from({ length: count }, (_, index) => {
    const exonStart = start + index * Math.floor((end - start) / count);
    const exonEnd = Math.min(end, exonStart + 800);
    return { id: `${id}.exon${index + 1}`, start: exonStart, end: exonEnd, exonNumber: index + 1, cdsStart: exonStart + 80, cdsEnd: exonEnd - 40 };
  }),
});

const hg38Genes: GeneAnnotation[] = [
  { id: "ENSG00000197530", symbol: "EML4", chromosome: "chr2", start: 42169352, end: 42332547, strand: "+", transcripts: [transcript("NM_019063.5", "+", 42169352, 42332547, 23, { maneSelect: true, canonical: true, appris: "principal" })] },
  { id: "ENSG00000171094", symbol: "ALK", chromosome: "chr2", start: 29192773, end: 29921585, strand: "-", transcripts: [transcript("NM_004304.5", "-", 29192773, 29921585, 29, { maneSelect: true, canonical: true, appris: "principal" })] },
];

const hg19Genes: GeneAnnotation[] = [
  { id: "ENSG00000197530", symbol: "EML4", chromosome: "chr2", start: 42396489, end: 42559687, strand: "+", transcripts: [transcript("NM_019063.5", "+", 42396489, 42559687, 23, { maneSelect: true, canonical: true, appris: "principal" })] },
  { id: "ENSG00000171094", symbol: "ALK", chromosome: "chr2", start: 29415639, end: 30144476, strand: "-", transcripts: [transcript("NM_004304.5", "-", 29415639, 30144476, 29, { maneSelect: true, canonical: true, appris: "principal" })] },
];

const bands = (length: number): ChromosomeAnnotation => ({ name: "chr", length, bands: [
  { name: "p11", start: 1, end: Math.floor(length * 0.2), stain: "gneg" },
  { name: "p12", start: Math.floor(length * 0.2) + 1, end: Math.floor(length * 0.45), stain: "gpos50" },
  { name: "q11", start: Math.floor(length * 0.45) + 1, end: Math.floor(length * 0.55), stain: "acen" },
  { name: "q12", start: Math.floor(length * 0.55) + 1, end: length, stain: "gneg" },
] });

const chromosomeRecords: Record<"hg19" | "hg38", ChromosomeAnnotation[]> = {
  hg38: [{ ...bands(242193529), name: "chr2" }, { ...bands(190214555), name: "chr4" }, { ...bands(58617616), name: "chr19" }],
  hg19: [{ ...bands(243199373), name: "chr2" }, { ...bands(191154276), name: "chr4" }, { ...bands(59128983), name: "chr19" }],
};

class DemoAnnotationProvider implements AnnotationProvider {
  private readonly packs = { hg38: new StaticAnnotationProvider("/annotation/hg38"), hg19: new StaticAnnotationProvider("/annotation/hg19") };
  private readonly fallback = { hg38: new MemoryAnnotationProvider(hg38Genes, chromosomeRecords.hg38), hg19: new MemoryAnnotationProvider(hg19Genes, chromosomeRecords.hg19) };
  private shouldUseFixture(error: unknown): boolean {
    const text = String(error);
    return /Unable to load annotation|Failed to fetch|NetworkError|fetch failed/i.test(text);
  }
  async getGene(assembly: Assembly, query: { symbol?: string; id?: string; chromosome?: string }) { const key = assembly === "hg19" ? "hg19" : "hg38"; try { return await this.packs[key].getGene(assembly, query) ?? this.fallback[key].getGene(assembly, query); } catch (error) { if (!this.shouldUseFixture(error)) throw error; return this.fallback[key].getGene(assembly, query); } }
  async getChromosome(assembly: Assembly, chromosome: string) { const key = assembly === "hg19" ? "hg19" : "hg38"; try { return await this.packs[key].getChromosome(assembly, chromosome) ?? this.fallback[key].getChromosome(assembly, chromosome); } catch (error) { if (!this.shouldUseFixture(error)) throw error; return this.fallback[key].getChromosome(assembly, chromosome); } }
  async getCytoband(assembly: Assembly, chromosome: string, position: number) { const key = assembly === "hg19" ? "hg19" : "hg38"; try { return await this.packs[key].getCytoband(assembly, chromosome, position) ?? this.fallback[key].getCytoband(assembly, chromosome, position); } catch (error) { if (!this.shouldUseFixture(error)) throw error; return this.fallback[key].getCytoband(assembly, chromosome, position); } }
  async getMetadata(assembly: Assembly) { const key = assembly === "hg19" ? "hg19" : "hg38"; try { const manifest = await this.packs[key].loadManifest(); return { source: manifest.annotationSource.url || manifest.annotationSource.name, annotationVersion: manifest.annotationSource.version, checksum: manifest.checksum }; } catch (error) { if (!this.shouldUseFixture(error)) throw error; return { source: "FusionDraw demo fixture", annotationVersion: key === "hg19" ? "demo-fixture-lift37" : "demo-fixture" }; } }
}

export const demoProvider = new DemoAnnotationProvider();
