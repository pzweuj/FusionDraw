import type {
  PlotExon,
  PlotExonBiologicalOverride,
  PlotExonVisualOverride,
} from "./types.js";

type BiologicalPatch = Partial<PlotExonBiologicalOverride>;
type VisualPatch = Partial<PlotExonVisualOverride>;

function compact<T extends Record<string, unknown>>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) as T : undefined;
}

/**
 * Apply one editor change without mutating the source annotation.
 *
 * Biological coordinate overrides are stored as a complete pair whenever the
 * other edge is available on the base exon. Clearing either coordinate means
 * "coordinate-free" for that exon, so both base coordinates are removed too;
 * this prevents the renderer from silently falling back to stale annotation
 * coordinates. A newly added exon may temporarily contain one edge while the
 * user is entering the second edge and will be reported by validation before
 * export.
 */
export function applyPlotExonEdit(
  exon: PlotExon,
  channel: "biological",
  patch: BiologicalPatch,
): PlotExon;
export function applyPlotExonEdit(
  exon: PlotExon,
  channel: "visual",
  patch: VisualPatch,
): PlotExon;
export function applyPlotExonEdit(
  exon: PlotExon,
  channel: "biological" | "visual",
  patch: BiologicalPatch | VisualPatch,
): PlotExon {
  // The public helper is deliberately defensive at the JSON/editor boundary:
  // malformed form payloads should be surfaced by PlotSpec validation rather
  // than crashing the whole editor while a user is still typing.
  if (channel !== "biological" && channel !== "visual") return { ...exon };
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { ...exon };
  if (channel === "visual") {
    const visual = { ...(exon.visual ?? {}) } as VisualPatch;
    for (const key of ["label", "width", "visible"] as const) {
      if (!(key in patch)) continue;
      const value = (patch as VisualPatch)[key];
      if (key === "label") {
        if (value === undefined) delete visual.label;
        else visual.label = value as string;
      } else if (key === "width") {
        if (value === undefined) delete visual.width;
        else visual.width = value as number;
      } else if (value === undefined) delete visual.visible;
      else visual.visible = value as boolean;
    }
    const result = { ...exon };
    const compacted = compact(visual as Record<string, unknown>) as PlotExon["visual"];
    if (compacted) result.visual = compacted;
    else delete result.visual;
    return result;
  }

  const biological = { ...(exon.biological ?? {}) } as BiologicalPatch;
  const coordinatePatched = "genomicStart" in patch || "genomicEnd" in patch;
  const clearCoordinates = coordinatePatched
    && (("genomicStart" in patch && patch.genomicStart === undefined)
      || ("genomicEnd" in patch && patch.genomicEnd === undefined));
  const result: PlotExon = { ...exon };

  if (clearCoordinates) {
    // An empty coordinate input is an explicit manual override, not a request
    // to reveal the original annotation again.
    delete result.genomicStart;
    delete result.genomicEnd;
    delete biological.genomicStart;
    delete biological.genomicEnd;
  } else if (coordinatePatched) {
    const start = "genomicStart" in patch ? patch.genomicStart : exon.biological?.genomicStart ?? exon.genomicStart;
    const end = "genomicEnd" in patch ? patch.genomicEnd : exon.biological?.genomicEnd ?? exon.genomicEnd;
    if (start !== undefined) biological.genomicStart = start;
    else delete biological.genomicStart;
    if (end !== undefined) biological.genomicEnd = end;
    else delete biological.genomicEnd;
  }

  for (const key of ["type", "breakpoint"] as const) {
    if (!(key in patch)) continue;
    const value = (patch as BiologicalPatch)[key];
    if (key === "type") {
      if (value === undefined) delete biological.type;
      else biological.type = value as PlotExonBiologicalOverride["type"];
    } else if (value === undefined) delete biological.breakpoint;
    else biological.breakpoint = value as boolean;
  }
  const compacted = compact(biological as Record<string, unknown>) as PlotExon["biological"];
  if (compacted) result.biological = compacted;
  else delete result.biological;
  return result;
}
