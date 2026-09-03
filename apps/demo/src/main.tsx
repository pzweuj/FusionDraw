import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { BreakpointResolution, FusionPlotSpec, Locale, PlotExon, PlotPartner, Strand } from "@fusionview/core";
import { parsePlotSpec, serializePlotSpec } from "@fusionview/core";
import { FusionView } from "@fusionview/react";
import { renderFusionSvg } from "@fusionview/renderer-svg";
import { demoProvider } from "./fixtures";
import "./styles.css";

const text = {
  en: {
    assembly: "Assembly", five: "5′ partner", three: "3′ partner",
    gene: "Gene", chromosome: "Chromosome", breakpoint: "Breakpoint", transcript: "Transcript ID", baseSequence: "Base sequence", strand: "Strand", exons: "Total exons", breakpointExon: "Breakpoint exon", color: "Color", showAllExons: "Show all exon numbers", breakpointMode: "Breakpoint location", breakpointBoundary: "Exon boundary", breakpointInterior: "Exon interior", breakpointIntron: "Intron",
    generate: "Generate diagram", download: "Download SVG", saveJson: "Export PlotSpec", importJson: "Import PlotSpec", github: "View FusionDraw on GitHub",
    empty: "No diagram yet", ready: "PlotSpec ready", warning: "Messages", diagnosis: "Research illustration · Not for clinical diagnosis",
    choose: "Enter two partners and press Generate.",
  },
  "zh-CN": {
    assembly: "组装版本", five: "5′ 端伙伴", three: "3′ 端伙伴",
    gene: "基因", chromosome: "染色体", breakpoint: "断点", transcript: "转录本编号", baseSequence: "碱基序列", strand: "链", exons: "总外显子数目", breakpointExon: "断点外显子编号", color: "颜色", showAllExons: "显示所有外显子编号", breakpointMode: "断点位置", breakpointBoundary: "外显子边界", breakpointInterior: "外显子内部", breakpointIntron: "内含子",
    generate: "生成图形", download: "下载 SVG", saveJson: "导出 PlotSpec", importJson: "导入 PlotSpec", github: "在 GitHub 查看 FusionDraw",
    empty: "尚未生成图形", ready: "PlotSpec 已就绪", warning: "消息", diagnosis: "科研示意图 · 不用于临床诊断",
    choose: "输入两个伙伴基因后生成。",
  },
} as const;

type AssemblyChoice = "hg38" | "hg19";
type PartnerForm = { gene: string; chromosome: string; breakpoint: string; transcriptId: string; baseSequence: string; strand: Strand; exonCount: number; breakpointExon: number; color: string; showAllExonLabels: boolean; breakpointMode: "boundary" | "interior" | "intron" };

const defaults: Record<AssemblyChoice, [PartnerForm, PartnerForm]> = {
  // Both assemblies default to the clinically recurrent EML4::ALK fusion,
  // variant 1 (EML4 exon 13 :: ALK exon 20). Breakpoints sit in EML4 intron 13
  // and ALK intron 19 (real patient breakpoints from Kunimasa et al., PLoS One
  // 2019, PMID 31513617; hg38 values are the corresponding ~lifted coordinates).
  hg38: [
    { gene: "EML4", chromosome: "chr2", breakpoint: "42296244", transcriptId: "NM_019063.5", baseSequence: "", strand: "+", exonCount: 23, breakpointExon: 13, color: "#2563eb", showAllExonLabels: false, breakpointMode: "boundary" },
    { gene: "ALK", chromosome: "chr2", breakpoint: "29225176", transcriptId: "NM_004304.5", baseSequence: "", strand: "-", exonCount: 29, breakpointExon: 20, color: "#7c3aed", showAllExonLabels: false, breakpointMode: "boundary" },
  ],
  hg19: [
    { gene: "EML4", chromosome: "chr2", breakpoint: "42523384", transcriptId: "NM_019063.5", baseSequence: "", strand: "+", exonCount: 23, breakpointExon: 13, color: "#2563eb", showAllExonLabels: false, breakpointMode: "boundary" },
    { gene: "ALK", chromosome: "chr2", breakpoint: "29448042", transcriptId: "NM_004304.5", baseSequence: "", strand: "-", exonCount: 29, breakpointExon: 20, color: "#7c3aed", showAllExonLabels: false, breakpointMode: "boundary" },
  ],
};

function isAssembly(value: string | undefined): value is AssemblyChoice {
  return value === "hg19" || value === "hg38";
}

function isStrand(value: string): value is Strand {
  return value === "+" || value === "-";
}

function parseBreakpoint(raw: string): number | undefined {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function exonsForCount(count: number): PlotExon[] {
  const safe = Number.isFinite(count) ? Math.min(99, Math.max(1, Math.floor(count))) : 1;
  return Array.from({ length: safe }, (_, index) => ({ label: String(index + 1), type: "unknown" as const }));
}

function clampBreakpointExon(bp: number, total: number): number {
  return Number.isFinite(bp) && Number.isInteger(bp) ? Math.min(total, Math.max(1, bp)) : 1;
}

function formFromPartner(partner: FusionPlotSpec["fivePrime"], fusionExons?: PlotExon[], color = "#2563eb"): PartnerForm {
  const exonCount = Math.max(1, partner.transcript.exons.length);
  let breakpointExon = 1;
  if (fusionExons && fusionExons.length > 0) {
    const raw = Number(fusionExons[fusionExons.length - 1]?.label ?? fusionExons[0]?.label);
    if (Number.isInteger(raw) && raw >= 1 && raw <= exonCount) breakpointExon = raw;
  }
  const resolution = partner.resolution;
  const breakpointMode: PartnerForm["breakpointMode"] = resolution?.region === "intron"
    ? "intron"
    : resolution?.breakpointLocation === "interior"
      ? "interior"
      : "boundary";
  return {
    gene: partner.gene.symbol,
    chromosome: partner.chromosome ?? "",
    breakpoint: partner.breakpoint === undefined ? "" : String(partner.breakpoint),
    transcriptId: partner.transcript.id ?? "",
    baseSequence: partner.baseSequence ?? "",
    strand: isStrand(partner.strand ?? "") ? partner.strand! : "+",
    exonCount,
    breakpointExon,
    color,
    showAllExonLabels: partner.showAllExonLabels ?? false,
    breakpointMode,
  };
}

function App() {
  const [locale, setLocale] = useState<Locale>("en");
  const t = text[locale];
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const [assembly, setAssembly] = useState<AssemblyChoice>("hg38");
  const [forms, setForms] = useState<[PartnerForm, PartnerForm]>(defaults.hg38.map((form) => ({ ...form })) as [PartnerForm, PartnerForm]);
  const [spec, setSpec] = useState<FusionPlotSpec>();
  const [messages, setMessages] = useState<{ severity: "error" | "warning"; text: string }[]>([]);
  const importInput = useRef<HTMLInputElement>(null);
  const editingSpec = spec;

  const updateForm = (index: 0 | 1, key: keyof PartnerForm, value: string | number | boolean) => {
    setForms((old) => old.map((item, i) => (i === index ? { ...item, [key]: value } : item)) as [PartnerForm, PartnerForm]);
  };

  const updateColor = (index: 0 | 1, value: string) => {
    updateForm(index, "color", value);
    // Keep the visible diagram in sync while the color is being picked.
    setSpec((old) => old ? {
      ...old,
      style: {
        ...old.style,
        ...(index === 0 ? { primaryColor: value } : { secondaryColor: value }),
      },
    } : old);
  };

  const buildSpec = async (inputForms: [PartnerForm, PartnerForm], selectedAssembly: AssemblyChoice, selectedLocale: Locale) => {
    const warnings: { severity: "error" | "warning"; text: string }[] = [];
    const makePartner = async (form: PartnerForm, side: 0 | 1): Promise<{ partner: PlotPartner; fusionExons: PlotExon[] }> => {
      const chromosome = form.chromosome.trim() || undefined;
      const breakpoint = parseBreakpoint(form.breakpoint);
      let chromosomeLength: number | undefined;
      let chromosomeBands: PlotPartner["chromosomeBands"];
      let cytoband: string | undefined;
      if (chromosome && breakpoint) {
        try {
          const record = await demoProvider.getChromosome(selectedAssembly, chromosome);
          if (record) {
            chromosomeLength = record.length;
            chromosomeBands = record.bands?.map((band) => ({ ...band }));
          } else {
            warnings.push({ severity: "warning", text: `No chromosome annotation available for ${chromosome} in ${selectedAssembly}.` });
          }
          cytoband = (await demoProvider.getCytoband(selectedAssembly, chromosome, breakpoint)) ?? undefined;
        } catch (error) {
          warnings.push({ severity: "warning", text: `Chromosome lookup failed for ${chromosome}: ${String(error)}` });
        }
      }
      // Fusion blocks use transcript order (1→N), while a negative-strand
      // source gene is drawn in genomic orientation (N→1) so its 3′ side and
      // exon numbering agree with the direction arrow.
      const exons = exonsForCount(form.exonCount);
      const sourceExons = form.strand === "-" ? [...exons].reverse() : exons;
      const mode = form.breakpointMode;
      const breakpointLimit = mode === "intron" ? Math.max(1, exons.length - 1) : exons.length;
      const bp = clampBreakpointExon(form.breakpointExon, breakpointLimit);
      // 5′ partner retains the 5′ portion (exons 1..bp); 3′ partner retains
      // the 3′ portion. The slice offset depends on the breakpoint mode:
      // boundary/interior keep the breakpoint exon in both blocks (offset
      // bp-1 for the 3′ side), while intron mode places the breakpoint
      // between exons bp and bp+1.
      let fusionExons: PlotExon[];
      if (mode === "intron") {
        fusionExons = side === 0 ? exons.slice(0, bp) : exons.slice(bp);
      } else {
        fusionExons = side === 0 ? exons.slice(0, bp) : exons.slice(bp - 1);
        // In interior mode the breakpoint exon is drawn at half width.
        if (mode === "interior" && fusionExons.length > 0) {
          fusionExons = fusionExons.map((e) => ({ ...e }));
          const target = side === 0 ? fusionExons[fusionExons.length - 1] : fusionExons[0];
          if (target) target.width = 17;
        }
      }
      // Build the synthetic resolution that drives the breakpoint dashed
      // connector in the schematic gene track.
      const resolution: BreakpointResolution | undefined = chromosome && breakpoint !== undefined ? {
        transcriptId: form.transcriptId.trim() || "",
        chromosome,
        position: breakpoint,
        strand: form.strand,
        region: mode === "intron" ? "intron" : "exon",
        codingRegion: "unknown",
        ...(mode === "intron" ? { intronNumber: bp } : { exonNumber: bp }),
        ...(mode === "interior" ? { breakpointLocation: "interior" as const } : {}),
      } : undefined;
      return {
        partner: {
          gene: { symbol: form.gene.trim() || (side === 0 ? "Gene A" : "Gene B") },
          chromosome,
          breakpoint,
          strand: form.strand,
          transcript: { id: form.transcriptId.trim() || undefined, exons: sourceExons },
          baseSequence: form.baseSequence.trim() || undefined,
          manual: true,
          chromosomeLength,
          chromosomeBands,
          cytoband,
          resolution,
          showAllExonLabels: form.showAllExonLabels,
        },
        fusionExons,
      };
    };
    const five = await makePartner(inputForms[0], 0);
    const three = await makePartner(inputForms[1], 1);
    setSpec({
      specVersion: "0.1",
      assembly: selectedAssembly,
      coordinateSystem: "1-based-inclusive",
      locale: selectedLocale,
      fivePrime: five.partner,
      threePrime: three.partner,
      fusion: {
        name: `${five.partner.gene.symbol}::${three.partner.gene.symbol}`,
        fivePrimeExons: five.fusionExons.map((exon) => ({ ...exon })),
        threePrimeExons: three.fusionExons.map((exon) => ({ ...exon })),
      },
      chromosomeView: { show: true, showCytoband: true },
      geneView: { layout: "schematic" },
      style: { primaryColor: inputForms[0].color, secondaryColor: inputForms[1].color },
    });
    setMessages(warnings);
  };

  const generate = () => void buildSpec(forms, assembly, locale);

  // Keep the built-in example diagram available on first load.
  useEffect(() => {
    void buildSpec(defaults.hg38, "hg38", "en");
    // The mount-time example intentionally uses the default example inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const download = (content: string, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const exportJson = () => {
    if (!editingSpec) return;
    try {
      download(serializePlotSpec(editingSpec), "fusiondraw.json", "application/json");
    } catch (error) {
      setMessages([{ severity: "error", text: String(error) }]);
    }
  };

  const exportSvg = () => {
    if (!editingSpec) return;
    try {
      download(renderFusionSvg(editingSpec), "fusiondraw.svg", "image/svg+xml");
    } catch (error) {
      setMessages([{ severity: "error", text: String(error) }]);
    }
  };

  const importJson = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((json) => {
      const next = parsePlotSpec(json);
      setSpec(next);
      setLocale(next.locale);
      if (isAssembly(next.assembly)) setAssembly(next.assembly);
      setForms([
        formFromPartner(next.fivePrime, next.fusion.fivePrimeExons, next.style?.primaryColor ?? "#2563eb"),
        formFromPartner(next.threePrime, next.fusion.threePrimeExons, next.style?.secondaryColor ?? "#7c3aed"),
      ]);
      setMessages([]);
    }).catch((error) => {
      setMessages([{ severity: "error", text: String(error) }]);
    });
    event.target.value = "";
  };

  const switchAssembly = (next: AssemblyChoice) => {
    setAssembly(next);
    setForms(defaults[next].map((form) => ({ ...form })) as [PartnerForm, PartnerForm]);
  };

  return <main className="app-shell">
    <header className="topbar">
      <div className="topbar-brand">
        <div className="brand-lockup">
          <img className="brand-logo" src="/fusiondraw-logo.svg" alt="" aria-hidden="true" />
          <h1 className="brand-wordmark">Fusion<span>Draw</span></h1>
        </div>
        <span className="eyebrow">FUSION SVG RENDERING ENGINE</span>
        <span className="tagline">{t.diagnosis}</span>
      </div>
      <div className="top-actions">
        <a className="github-link" href="https://github.com/pzweuj/FusionDraw" target="_blank" rel="noreferrer" aria-label={t.github} title={t.github}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.084-.729.084-.729 1.205.084 1.84 1.237 1.84 1.237 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.292-1.552 3.297-1.23 3.297-1.23.647 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.81 1.102.81 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
        </a>
        <button className="lang-toggle" onClick={() => {
          const next: Locale = locale === "en" ? "zh-CN" : "en";
          setLocale(next);
          setSpec((old) => old ? { ...old, locale: next } : old);
        }} aria-label="Language">{locale === "en" ? "中文" : "EN"}</button>
      </div>
    </header>
    <section className="workspace">
      <section className="canvas">
        <div className="canvas-toolbar"><div><span className="status-dot" />{editingSpec ? t.ready : t.empty}</div><div className="toolbar-actions">
          <button disabled={!editingSpec} onClick={exportJson}>{t.saveJson}</button>
          <button onClick={() => importInput.current?.click()}>{t.importJson}</button>
          <input ref={importInput} type="file" accept="application/json" onChange={importJson} style={{ display: "none" }} />
        </div></div>
        <div className="preview">{editingSpec ? <FusionView spec={editingSpec} /> : <div className="empty-state"><div className="empty-icon">✦</div><h2>{t.empty}</h2><p>{t.choose}</p></div>}</div>
      </section>
      <aside className="panel editor">
        <div className="editor-scroll">
          {messages.length > 0 && <div className="messages"><strong>{t.warning}</strong>{messages.map((item, index) => <div className={item.severity === "error" ? "error" : "warning"} key={`${item.severity}-${index}`}>{item.text}</div>)}</div>}
          <label className="assembly-field">{t.assembly}<select value={assembly} onChange={(event) => switchAssembly(event.target.value as AssemblyChoice)}><option value="hg38">hg38 / GRCh38</option><option value="hg19">hg19 / GRCh37</option></select></label>
          {([0, 1] as const).map((index) => <fieldset className="partner-fields" key={index}>
            <legend>{index === 0 ? t.five : t.three}</legend>
            <div className="grid-two">
              <label>{t.gene}<input value={forms[index].gene} onChange={(event) => updateForm(index, "gene", event.target.value)} /></label>
              <label>{t.strand}<select value={forms[index].strand} onChange={(event) => updateForm(index, "strand", event.target.value)}><option value="+">+</option><option value="-">−</option></select></label>
            </div>
            <div className="grid-two">
              <label>{t.chromosome}<input value={forms[index].chromosome} onChange={(event) => updateForm(index, "chromosome", event.target.value)} /></label>
              <label>{t.breakpoint}<input inputMode="numeric" value={forms[index].breakpoint} onChange={(event) => updateForm(index, "breakpoint", event.target.value)} /></label>
            </div>
            <div className="grid-two">
              <label>{t.transcript}<input value={forms[index].transcriptId} onChange={(event) => updateForm(index, "transcriptId", event.target.value)} /></label>
              <label>{t.baseSequence}<input value={forms[index].baseSequence} onChange={(event) => updateForm(index, "baseSequence", event.target.value)} /></label>
            </div>
            <div className="grid-three">
              <label>{t.exons}<input type="number" min="1" max="99" value={forms[index].exonCount} onChange={(event) => updateForm(index, "exonCount", event.target.value === "" ? 1 : Number(event.target.value))} /></label>
              <label>{t.breakpointExon}<input type="number" min="1" max={forms[index].breakpointMode === "intron" ? Math.max(1, forms[index].exonCount - 1) : Math.max(1, forms[index].exonCount)} value={forms[index].breakpointExon} onChange={(event) => updateForm(index, "breakpointExon", event.target.value === "" ? 1 : Number(event.target.value))} /></label>
              <label>{t.breakpointMode}<select value={forms[index].breakpointMode} onChange={(event) => updateForm(index, "breakpointMode", event.target.value)}><option value="boundary">{t.breakpointBoundary}</option><option value="interior">{t.breakpointInterior}</option><option value="intron">{t.breakpointIntron}</option></select></label>
            </div>
            <div className="partner-options">
              <label className="inline-control color-control"><span>{t.color}</span><input className="color-input" aria-label={t.color} type="color" value={forms[index].color} onChange={(event) => updateColor(index, event.target.value)} /></label>
              <label className="inline-control checkbox-control"><input type="checkbox" checked={forms[index].showAllExonLabels} onChange={(event) => updateForm(index, "showAllExonLabels", event.target.checked)} /><span>{t.showAllExons}</span></label>
            </div>
          </fieldset>)}
        </div>
        <div className="editor-actions">
          <button className="primary-button" onClick={generate}>{t.generate}<span>→</span></button>
          <button className="secondary-button" disabled={!editingSpec} onClick={exportSvg}>{t.download}</button>
        </div>
      </aside>
    </section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
