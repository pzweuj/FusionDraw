import React, { useId, useMemo } from "react";
import type { FusionPlotSpec } from "@fusionview/core";
import { layoutFusion, type VisualElement } from "@fusionview/layout";

export interface FusionViewProps {
  spec: FusionPlotSpec;
  /** Reserved for future interactive gestures; V0.1 rendering is pure. */
  onChange?: (spec: FusionPlotSpec) => void;
  className?: string;
}

const reactAttributeName: Record<string, string> = {
  "stroke-width": "strokeWidth",
  "stroke-dasharray": "strokeDasharray",
  "text-anchor": "textAnchor",
  "font-size": "fontSize",
  "font-family": "fontFamily",
  "font-weight": "fontWeight",
};

function toReactAttrs(element: VisualElement): Record<string, string | number | undefined> {
  return Object.fromEntries(Object.entries(element.attrs).map(([name, value]) => [reactAttributeName[name] ?? name, value]));
}

export function FusionView({ spec, className }: FusionViewProps): React.ReactElement {
  const model = useMemo(() => layoutFusion(spec), [spec]);
  const reactId = useId();
  const titleId = `fusionview-title-${reactId.replace(/:/g, "")}`;
  const resolvedClassName = className ?? "fusionview-svg";
  const title = spec.locale === "zh-CN" ? "FusionDraw 融合图" : "FusionDraw fusion diagram";
  const renderElement = (element: VisualElement, index: number) => React.createElement(element.tag, { ...toReactAttrs(element), key: index } as React.SVGAttributes<SVGElement> & { key: number }, element.text);
  return <svg className={resolvedClassName} xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby={titleId} width="100%" height="auto" viewBox={model.viewBox} preserveAspectRatio="xMidYMid meet"><title id={titleId}>{title}</title>{model.layers.map((layer) => <g id={layer.id} key={layer.id}>{layer.elements.map(renderElement)}</g>)}</svg>;
}
