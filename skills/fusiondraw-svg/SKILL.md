---
name: fusiondraw-svg
description: Generate FusionDraw fusion-gene diagrams through the local SVG API, asking focused follow-up questions when required gene or fusion-segment information is missing.
metadata:
  short-description: Generate fusion-gene SVG diagrams
---

# FusionDraw SVG

Use this skill when a user asks to create, render, export, or download a fusion-gene diagram with FusionDraw. The render endpoint returns SVG for research illustration; it is not a clinical interpretation service.

## Collect the drawing information

Keep the transcript direction explicit: `fivePrime` is the 5′ partner and `threePrime` is the 3′ partner.

A schematic request is complete only when it has:

- a non-empty gene symbol for both partners; and
- the retained fusion exon segments for both sides, expressed as individual labels (for example, `1`, `2`, `13`, `20`), or an explicitly confirmed abstract placeholder such as one exon labelled `1` per side.

If either item is missing, ask a concise follow-up question before calling the API. If the user only provides two gene names, ask for the retained exon ranges or breakpoint exon/intron numbers. Do not invent a transcript, exon range, or genomic coordinate from a gene-fusion name alone. If the user wants an abstract schematic and does not have biological details, offer the placeholder option and make that limitation clear.

Only ask for genomic details when the user wants a chromosome/genomic view or an exact breakpoint annotation. Then collect, for each partner:

- assembly, such as `hg38` or `hg19`;
- chromosome;
- 1-based inclusive breakpoint coordinate; and
- strand (`+` or `-`).

When a `resolution` object is sent, also collect the transcript ID and the appropriate exon or intron number. Do not send a partial `resolution` object; omit it until all of its required fields are known.

Ask missing questions in one message where possible. Locale, colors, gene display names, and output filename are optional; use `en`, `#2563eb`, `#7c3aed`, and a sensible filename when the user has not specified them.

## Build the PlotSpec

Send a `FusionPlotSpec` with this required shape:

```json
{
  "specVersion": "0.1",
  "coordinateSystem": "1-based-inclusive",
  "locale": "en",
  "fivePrime": {
    "gene": { "symbol": "GENE5" },
    "transcript": { "exons": [{ "label": "1" }] }
  },
  "threePrime": {
    "gene": { "symbol": "GENE3" },
    "transcript": { "exons": [{ "label": "1" }] }
  },
  "fusion": {
    "name": "GENE5::GENE3",
    "fivePrimeExons": [{ "label": "1" }],
    "threePrimeExons": [{ "label": "1" }]
  },
  "chromosomeView": { "show": false },
  "style": { "primaryColor": "#2563eb", "secondaryColor": "#7c3aed" }
}
```

Use one exon object per retained segment in `fusion.fivePrimeExons` and `fusion.threePrimeExons`; do not put a range such as `1-13` in place of the individual segments unless the user explicitly wants that as a visual label. The partner transcript must always contain an `exons` array, even for a coordinate-free manual schematic. If a user supplies biological exon data, preserve it rather than replacing it with placeholders.

For a genomic view, add the complete partner fields (`assembly`, `chromosome`, `breakpoint`, `strand`, `transcript.id`) and a consistent `resolution`. All coordinates remain 1-based inclusive. Keep the `resolution` chromosome, position, strand, and transcript ID consistent with the corresponding partner.

## Call the API

Resolve the API base URL in this order:

1. Use a base URL explicitly provided by the user.
2. Otherwise use the planned production deployment at `https://fusiondraw.biotools.space`.
3. If the production endpoint is unavailable and local development is in scope, use the currently running local FusionDraw server.

The endpoint is:

```text
POST {baseUrl}/api/render-svg
Content-Type: application/json
```

For the planned production deployment, call `https://fusiondraw.biotools.space/api/render-svg`. For local development, the default Vite URL is `http://127.0.0.1:5173`; if that port is occupied, use the URL printed by `pnpm dev` (Vite may select the next available port). If no local server is running and starting local development is within the user's request, run `pnpm dev` and use its reported URL. Do not claim that the planned production URL is live unless the request actually succeeds.

Treat the response according to its status and content type:

- `200` with `image/svg+xml`: return the SVG or save the exact response as the requested `.svg` file. Verify that the response contains an `<svg` root before claiming success.
- `400` with JSON: report the relevant validation message and ask the user for the missing or corrected field; do not blindly retry the same payload.
- `405`: use `POST` or `OPTIONS`; do not use `GET` for rendering.
- `500` or a connection error: check that the dev server and base URL are correct, then report the concrete problem.

Do not claim that this endpoint produced PNG/JPG or that it validated a diagnosis. It produces an SVG research illustration from the supplied PlotSpec.
