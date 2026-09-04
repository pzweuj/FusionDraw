import type { FusionPlotSpec } from "./types.js";
import { validatePlotSpec } from "./validation.js";

export function serializePlotSpec(spec: FusionPlotSpec): string {
  const errors = validatePlotSpec(spec);
  if (errors.length) throw new Error(`Cannot serialize invalid PlotSpec: ${errors.join(" ")}`);
  return JSON.stringify(spec, null, 2);
}

export function parsePlotSpec(json: string): FusionPlotSpec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`Invalid PlotSpec JSON: ${String(error)}`);
  }
  const errors = validatePlotSpec(parsed);
  if (errors.length) throw new Error(`Invalid PlotSpec: ${errors.join(" ")}`);
  return parsed as FusionPlotSpec;
}
