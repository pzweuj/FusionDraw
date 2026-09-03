import type { FusionPlotSpec } from "@fusionview/core";
import { validatePlotSpec } from "@fusionview/core";
import { layoutFusion, type FusionVisualModel, type VisualElement } from "@fusionview/layout";

export interface SvgRenderOptions { width?: number; height?: number; className?: string; title?: string; }

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderElement(element: VisualElement): string {
  const attrs = Object.entries(element.attrs)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}="${escapeXml(String(value))}"`).join(" ");
  const body = element.text === undefined ? "" : escapeXml(element.text);
  return `<${element.tag}${attrs ? ` ${attrs}` : ""}>${body}</${element.tag}>`;
}

function validDimension(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function renderVisualModel(model: FusionVisualModel, options: SvgRenderOptions = {}): string {
  const safeOptions: SvgRenderOptions = options && typeof options === "object" ? options : {};
  const body = model.layers.map((layer) => `<g id="${escapeXml(layer.id)}">${layer.elements.map(renderElement).join("")}</g>`).join("");
  const title = safeOptions.title ?? "FusionDraw fusion diagram";
  const klass = safeOptions.className ? ` class="${escapeXml(safeOptions.className)}"` : "";
  const width = validDimension(safeOptions.width, model.width);
  const height = validDimension(safeOptions.height, model.height);
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="fusionview-title"${klass} width="${width}" height="${height}" viewBox="${model.viewBox}" preserveAspectRatio="xMidYMid meet"><title id="fusionview-title">${escapeXml(title)}</title>${body}</svg>`;
}

export function renderFusionSvg(spec: FusionPlotSpec, options: SvgRenderOptions = {}): string {
  const errors = validatePlotSpec(spec);
  if (errors.length) throw new Error(`Invalid PlotSpec: ${errors.join(" ")}`);
  const safeOptions: SvgRenderOptions = options && typeof options === "object" ? options : {};
  const localizedOptions = safeOptions.title === undefined
    ? { ...safeOptions, title: spec.locale === "zh-CN" ? "FusionDraw 融合图" : "FusionDraw fusion diagram" }
    : safeOptions;
  return renderVisualModel(layoutFusion(spec, safeOptions), localizedOptions);
}

export { layoutFusion } from "@fusionview/layout";
export type { FusionVisualModel } from "@fusionview/layout";
