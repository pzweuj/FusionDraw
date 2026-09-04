import assert from "node:assert/strict";

const renderer = await import("../packages/renderer-svg/dist/index.js");

assert.equal(
  typeof renderer.renderFusionSvg,
  "function",
  "The compiled renderer package must expose renderFusionSvg to native Node ESM.",
);

console.log("Native Node ESM loaded the compiled renderer successfully.");
