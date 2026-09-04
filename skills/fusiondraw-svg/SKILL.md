---
name: fusiondraw-svg
description: Generate FusionDraw fusion-gene diagrams through the FusionDraw SVG API, asking focused follow-up questions when required gene or fusion-segment information is missing.
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

Only ask for genomic details when the user wants a chromosome/genomic view or an exact breakpoint annotation. Then collect:

- a top-level assembly, such as `hg38` or `hg19`;

For each partner, collect:

- chromosome;
- 1-based inclusive breakpoint coordinate;
- strand (`+` or `-`);
- the chromosome length for that assembly; and
- the chromosome's cytoband bands as `chromosomeBands` entries (`name`, `start`, `end`, `stain`) covering the whole chromosome.

The renderer only draws ideogram bands when `chromosomeBands` is a non-empty sorted list that spans `1` to `chromosomeLength`. If you cannot obtain the band list, say so and ask the user to supply it (for example from the assembly's cytoband table) rather than silently omitting it, which renders the chromosome as an empty bar with no bands.

When a `resolution` object is sent, also collect the partner transcript ID and a complete resolution: `transcriptId`, `chromosome`, `position`, `strand`, `region`, and `codingRegion`. Add `exonNumber` when `region` is `exon`, or `intronNumber` when `region` is `intron`. Do not send a partial `resolution` object; omit it until all of its required fields are known.

Ask missing questions in one message where possible. Locale, colors, gene display names, and output filename are optional; use `en`, `#2563eb`, `#7c3aed`, and a sensible filename when the user has not specified them.

## Build the PlotSpec

Copy the template that matches the user's request, then replace every example value with the user's data. Do not invent biological coordinates just to fill a template. The six required top-level keys are `specVersion`, `coordinateSystem`, `locale`, `fivePrime`, `threePrime`, and `fusion`. Omit unknown optional fields; do not send `null`, empty strings, or fake IDs/coordinates.

### Coordinate-free schematic template

Use this smallest valid template when the user wants an abstract drawing and has no genomic annotation. Keep one object per exon segment; the example uses three retained 5′ segments and two retained 3′ segments.

```json
{
  "specVersion": "0.1",
  "coordinateSystem": "1-based-inclusive",
  "locale": "en",
  "fivePrime": {
    "gene": { "symbol": "GENE5" },
    "transcript": {
      "exons": [
        { "label": "1" },
        { "label": "2" },
        { "label": "13" }
      ]
    }
  },
  "threePrime": {
    "gene": { "symbol": "GENE3" },
    "transcript": {
      "exons": [
        { "label": "20" },
        { "label": "21" }
      ]
    }
  },
  "fusion": {
    "name": "GENE5::GENE3",
    "fivePrimeExons": [
      { "label": "1" },
      { "label": "2" },
      { "label": "13" }
    ],
    "threePrimeExons": [
      { "label": "20" },
      { "label": "21" }
    ]
  },
  "chromosomeView": { "show": false },
  "style": { "primaryColor": "#2563eb", "secondaryColor": "#7c3aed" }
}
```

### Genomic/chromosome-view template

Use this template when the user requests genomic coordinates, a chromosome ideogram, or an exact breakpoint annotation. The numbers are internally consistent examples only; replace them with real annotation. This example resolves both breakpoints inside an exon, so it includes the exon-specific resolution fields.

```json
{
  "specVersion": "0.1",
  "assembly": "hg38",
  "coordinateSystem": "1-based-inclusive",
  "locale": "en",
  "fivePrime": {
    "gene": {
      "symbol": "GENE5",
      "id": "GENE5_ID",
      "displayName": "Gene 5"
    },
    "chromosome": "chr1",
    "breakpoint": 100250,
    "strand": "+",
    "transcript": {
      "id": "TX5",
      "displayName": "GENE5 transcript",
      "exons": [
        { "label": "1", "id": "TX5_EXON_1", "genomicStart": 100000, "genomicEnd": 100099, "type": "coding" },
        { "label": "2", "id": "TX5_EXON_2", "genomicStart": 100150, "genomicEnd": 100249, "type": "coding" },
        { "label": "3", "id": "TX5_EXON_3", "genomicStart": 100250, "genomicEnd": 100349, "type": "coding" }
      ]
    },
    "resolution": {
      "transcriptId": "TX5",
      "chromosome": "chr1",
      "position": 100250,
      "strand": "+",
      "region": "exon",
      "codingRegion": "cds",
      "exonNumber": 3,
      "exonOffset": 1,
      "breakpointLocation": "boundary",
      "cytoband": "p36.33"
    },
    "cytoband": "p36.33",
    "chromosomeLength": 248956422,
    "chromosomeBands": [
      { "name": "p36.33", "start": 1, "end": 2100000, "stain": "gneg" },
      { "name": "p36.3", "start": 2100001, "end": 5300000, "stain": "gpos25" },
      { "name": "p36.22", "start": 5300001, "end": 9600000, "stain": "gneg" },
      { "name": "p34.3", "start": 9600001, "end": 16600000, "stain": "gpos50" },
      { "name": "p31.1", "start": 16600001, "end": 24000000, "stain": "gneg" },
      { "name": "p22.3", "start": 24000001, "end": 30500000, "stain": "gpos100" },
      { "name": "p13.3", "start": 30500001, "end": 36000000, "stain": "gneg" },
      { "name": "p12", "start": 36000001, "end": 39100000, "stain": "gpos50" },
      { "name": "p11.2", "start": 39100001, "end": 45700000, "stain": "gneg" },
      { "name": "p11.1", "start": 45700001, "end": 49100000, "stain": "acen" },
      { "name": "q11", "start": 49100001, "end": 53500000, "stain": "acen" },
      { "name": "q12", "start": 53500001, "end": 59300000, "stain": "gneg" },
      { "name": "q21.2", "start": 59300001, "end": 67500000, "stain": "gpos50" },
      { "name": "q23.1", "start": 67500001, "end": 72800000, "stain": "gneg" },
      { "name": "q24.2", "start": 72800001, "end": 76200000, "stain": "gpos25" },
      { "name": "q25.3", "start": 76200001, "end": 84000000, "stain": "gneg" },
      { "name": "q31.1", "start": 84000001, "end": 90700000, "stain": "gpos50" },
      { "name": "q32.1", "start": 90700001, "end": 97800000, "stain": "gneg" },
      { "name": "q41", "start": 97800001, "end": 105900000, "stain": "gpos50" },
      { "name": "q42.2", "start": 105900001, "end": 113200000, "stain": "gneg" },
      { "name": "q43", "start": 113200001, "end": 121000000, "stain": "gpos25" },
      { "name": "q44", "start": 121000001, "end": 248956422, "stain": "gneg" }
    ]
  },
  "threePrime": {
    "gene": {
      "symbol": "GENE3",
      "id": "GENE3_ID",
      "displayName": "Gene 3"
    },
    "chromosome": "chr2",
    "breakpoint": 200500,
    "strand": "-",
    "transcript": {
      "id": "TX3",
      "displayName": "GENE3 transcript",
      "exons": [
        { "label": "1", "id": "TX3_EXON_1", "genomicStart": 200000, "genomicEnd": 200099, "type": "coding" },
        { "label": "2", "id": "TX3_EXON_2", "genomicStart": 200300, "genomicEnd": 200399, "type": "coding" },
        { "label": "3", "id": "TX3_EXON_3", "genomicStart": 200450, "genomicEnd": 200599, "type": "coding" },
        { "label": "4", "id": "TX3_EXON_4", "genomicStart": 200700, "genomicEnd": 200799, "type": "coding" }
      ]
    },
    "resolution": {
      "transcriptId": "TX3",
      "chromosome": "chr2",
      "position": 200500,
      "strand": "-",
      "region": "exon",
      "codingRegion": "cds",
      "exonNumber": 3,
      "exonOffset": 100,
      "breakpointLocation": "interior",
      "cytoband": "q21.1"
    },
    "cytoband": "q21.1",
    "chromosomeLength": 242193529,
    "chromosomeBands": [
      { "name": "p25.3", "start": 1, "end": 4000000, "stain": "gneg" },
      { "name": "p24.1", "start": 4000001, "end": 8800000, "stain": "gpos50" },
      { "name": "p22.3", "start": 8800001, "end": 13500000, "stain": "gneg" },
      { "name": "p21.1", "start": 13500001, "end": 18300000, "stain": "gpos50" },
      { "name": "p16.1", "start": 18300001, "end": 22500000, "stain": "gneg" },
      { "name": "p14", "start": 22500001, "end": 25800000, "stain": "gpos25" },
      { "name": "p12", "start": 25800001, "end": 28100000, "stain": "gneg" },
      { "name": "p11.2", "start": 28100001, "end": 30000000, "stain": "gpos50" },
      { "name": "p11.1", "start": 30000001, "end": 33400000, "stain": "acen" },
      { "name": "q11.1", "start": 33400001, "end": 36800000, "stain": "acen" },
      { "name": "q12.1", "start": 36800001, "end": 41700000, "stain": "gneg" },
      { "name": "q14.1", "start": 41700001, "end": 47800000, "stain": "gpos50" },
      { "name": "q21.1", "start": 47800001, "end": 54000000, "stain": "gneg" },
      { "name": "q22.1", "start": 54000001, "end": 60000000, "stain": "gpos25" },
      { "name": "q23.3", "start": 60000001, "end": 66800000, "stain": "gneg" },
      { "name": "q31.1", "start": 66800001, "end": 74200000, "stain": "gpos75" },
      { "name": "q32.1", "start": 74200001, "end": 80600000, "stain": "gneg" },
      { "name": "q33.1", "start": 80600001, "end": 87000000, "stain": "gpos25" },
      { "name": "q34", "start": 87000001, "end": 93500000, "stain": "gneg" },
      { "name": "q35", "start": 93500001, "end": 100100000, "stain": "gpos50" },
      { "name": "q36.1", "start": 100100001, "end": 106200000, "stain": "gneg" },
      { "name": "q37.1", "start": 106200001, "end": 112900000, "stain": "gpos50" },
      { "name": "q37.3", "start": 112900001, "end": 242193529, "stain": "gneg" }
    ]
  },
  "fusion": {
    "name": "GENE5::GENE3",
    "fivePrimeExons": [
      { "label": "1", "genomicStart": 100000, "genomicEnd": 100099 },
      { "label": "2", "genomicStart": 100150, "genomicEnd": 100249 },
      { "label": "3", "genomicStart": 100250, "genomicEnd": 100250 }
    ],
    "threePrimeExons": [
      { "label": "3", "genomicStart": 200450, "genomicEnd": 200499 },
      { "label": "2", "genomicStart": 200300, "genomicEnd": 200399 },
      { "label": "1", "genomicStart": 200000, "genomicEnd": 200099 }
    ]
  },
  "chromosomeView": { "show": true, "showCytoband": true },
  "geneView": {
    "layout": "genomic",
    "visibleExonsBefore": 2,
    "visibleExonsAfter": 2
  },
  "style": {
    "primaryColor": "#2563eb",
    "secondaryColor": "#7c3aed"
  },
  "provenance": {
    "source": "annotation provider",
    "annotationVersion": "release-id",
    "generatedAt": "2026-01-01T00:00:00Z"
  }
}
```

The template's `resolution` objects are the exon form, and `breakpointLocation` defaults to `"boundary"` when omitted. Model a variant named by its exon numbers (for example `e14a2`/`b3a2`) at the exon boundary: keep `region: "exon"` with `exonNumber` equal to the boundary exon of each partner, and keep that exon in the retained segments (5′ partner retains `1..N`, 3′ partner retains `N..last`). This matches the FusionDraw web app and renders the two fused blocks touching at the junction with no dashed connector between them.

Use the intron form only when the breakpoint is explicitly inside an intron (not at an exon boundary). Then the 5′ partner retains `1..N` and the 3′ partner retains `N+1..last`, and the renderer draws a dashed connector across the junction gap. To model an intronic breakpoint, change that partner's `breakpoint` and the matching `fusion` segment coordinates to the intron base, then replace the location-specific part with an object like this. Remove `exonNumber`, `exonOffset`, and `breakpointLocation`:

```json
{
  "transcriptId": "TX5",
  "chromosome": "chr1",
  "position": 100125,
  "strand": "+",
  "region": "intron",
  "codingRegion": "noncoding",
  "intronNumber": 1
}
```

For a point outside the selected transcript annotation, change the partner `breakpoint` and matching `resolution.position`, use `region: "outside"`, omit both exon/intron numbers, and use `codingRegion: "unknown"` unless the source explicitly supplies another value:

```json
{
  "transcriptId": "TX5",
  "chromosome": "chr1",
  "position": 99999,
  "strand": "+",
  "region": "outside",
  "codingRegion": "unknown"
}
```

### Common mistakes

- **Omit `chromosomeBands`**: without a non-empty band list the chromosome bar renders with no ideogram bands. Always include `chromosomeBands` (sorted, non-overlapping, spanning `1` to `chromosomeLength`) for every partner in a chromosome view.
- **Set `breakpoint: true` on an exon in a genomic view**: the breakpoint marker is derived from the partner `breakpoint` plus `resolution`. Marking an exon additionally draws a dashed line at that exon's center, so the breakpoint shows multiple dashed lines. Do not set `breakpoint: true` when `breakpoint`/`resolution` are present.
- **Send a partial `resolution`**: omit `resolution` entirely until all of its required fields are known, and never leave it half-populated.
- **Override style defaults**: send only `primaryColor`/`secondaryColor` unless the user asks for specific colors or fonts. Leave `breakpointColor`, `fontFamily`, and `fontSize` unset so the diagram uses the renderer defaults and matches the FusionDraw web app.

### Field formats and invariants

Use these rules while filling either template. “Required” below means required by the PlotSpec schema; genomic-view requirements are additionally required by this skill when that view is requested.

Top-level fields:

| Field | Format | Required / use |
| --- | --- | --- |
| `specVersion` | Exact string `"0.1"` | Required. |
| `assembly` | Non-empty string such as `"hg38"` or `"hg19"` | Optional in a schematic; required for a genomic/chromosome view. Keep it at the top level, never inside a partner. |
| `coordinateSystem` | Exact string `"1-based-inclusive"` | Required. Every genomic start, end, breakpoint, position, and cytoband bound uses this convention. |
| `locale` | Exactly `"en"` or `"zh-CN"` | Required. |
| `fivePrime` / `threePrime` | Partner object | Required. `fivePrime` is the 5′ source and `threePrime` is the 3′ source; do not swap them. |
| `fusion` | Object containing `name`, `fivePrimeExons`, and `threePrimeExons` | Required. |
| `chromosomeView.show` | Boolean | Optional; set `true` only when chromosome data is supplied. |
| `chromosomeView.showCytoband` | Boolean | Optional; `true` renders the partner `chromosomeBands` as ideogram bands. Use `true` whenever `chromosomeBands` is supplied. |
| `geneView.layout` | `"schematic"` or `"genomic"` | Optional; use `"genomic"` for coordinate-scaled gene tracks. |
| `geneView.visibleExonsBefore` / `visibleExonsAfter` | Non-negative integer (`0`, `1`, `2`, …) | Optional number of neighboring exons to show around each breakpoint. |
| `style.primaryColor`, `secondaryColor`, `breakpointColor`, `fontFamily` | Non-empty string; CSS color strings are recommended for colors | Optional. |
| `style.fontSize` | Positive number | Optional. |
| `provenance.source`, `annotationVersion`, `annotationChecksum`, `generatedAt` | String; use an ISO-8601 timestamp for `generatedAt` | Optional metadata; do not fabricate provenance. |

Partner fields (`fivePrime` and `threePrime`):

| Field | Format | Required / use |
| --- | --- | --- |
| `gene.symbol` | Non-empty string, normally the approved gene symbol | Required. |
| `gene.id` | Non-empty string such as an Ensembl gene ID | Optional. |
| `gene.displayName` | String | Optional human-readable label. |
| `chromosome` | Non-empty string such as `"chr1"`, `"1"`, or `"X"` | Optional for schematic; required for genomic view and must match `resolution.chromosome` when resolution is present. |
| `breakpoint` | Positive integer genomic base | Optional for schematic; required for genomic view and must equal `resolution.position` when resolution is present. |
| `strand` | Exactly `"+"` or `"-"` | Optional for schematic; required for genomic view and must equal `resolution.strand` when resolution is present. |
| `transcript.id` | Non-empty string | Optional for schematic; required when using `resolution`, and must equal `resolution.transcriptId`. |
| `transcript.displayName` | String | Optional. |
| `transcript.exons` | Array of exon objects (including a one-item placeholder for an abstract schematic) | Required. Preserve supplied biological exon data. |
| `availableTranscripts[]` | Objects with non-empty `id` and optional string `displayName` | Optional list of alternative transcript choices; IDs must be unique. |
| `cytoband` | Non-empty string such as `"p36.33"` | Optional label for this partner's breakpoint. |
| `chromosomeLength` | Positive integer | Optional chromosome length; if supplied, breakpoint, resolution position, exon ends, and band ends must not exceed it. |
| `chromosomeBands[]` | Objects with `name` (non-empty string), positive integer `start`/`end` (`start <= end`), optional string `stain` | Required for a chromosome view: without a non-empty `chromosomeBands` array the ideogram renders as an empty bar with no bands. List the whole chromosome, sorted and non-overlapping, spanning `start = 1` to `end = chromosomeLength`. Use the real assembly cytoband table; `stain` values such as `gneg`, `gpos25/50/75/100`, `acen`, `gvar`, `stalk` control the band color. |
| `manual` | Boolean | Optional; set `true` for an explicitly coordinate-free/manual partner. |
| `baseSequence` | String | Optional nucleotide sequence to render; do not add whitespace or claim a sequence that was not supplied. |

Exon objects (`transcript.exons[]` and `fusion.*Exons[]`):

| Field | Format | Required / use |
| --- | --- | --- |
| `label` | Non-empty string; numeric exon labels should still be strings (`"1"`, `"13"`) | Required. It is the displayed segment label, not a range expression. |
| `id` | Non-empty string | Optional exon identifier. |
| `genomicStart` / `genomicEnd` | Positive integers, supplied together, with `genomicStart <= genomicEnd` | Optional biological coordinates; both use 1-based inclusive bases. |
| `width` | Positive number | Optional visual width override; use only when a visual width is intentionally requested. |
| `type` | `"coding"`, `"utr"`, or `"unknown"` | Optional biological classification. |
| `breakpoint` | Boolean | Optional marker for the segment containing/at the breakpoint. Do not set it when the partner also provides `breakpoint`/`resolution`: the renderer derives the breakpoint marker from those and additionally draws a dashed line at the center of every exon marked `breakpoint: true`, producing a duplicate dashed line at the breakpoint. Leave it unset in a genomic/chromosome view. |
| `visible` | Boolean | Optional; `false` hides the segment. |
| `biological` | Object with optional `genomicStart`, `genomicEnd`, `type`, and `breakpoint` in the same formats above | Optional biological override; coordinates must be supplied as a pair. |
| `visual` | Object with optional non-empty string `label`, positive number `width`, and boolean `visible` | Optional visual-only override; it does not change biological coordinates. |

Fusion fields:

| Field | Format | Required / use |
| --- | --- | --- |
| `fusion.name` | Non-empty string, conventionally `"GENE5::GENE3"` | Required. |
| `fusion.fivePrimeExons` / `threePrimeExons` | Arrays of exon objects | Required. Use one object per retained segment, in transcript direction; keep at least one visible segment across the two arrays. Do not replace `[ {"label":"1"}, {"label":"2"}, {"label":"13"} ]` with one `"1-13"` object unless the user explicitly wants `1-13` as a visual label. |

Resolution fields (`partner.resolution`):

| Field | Format | Required / use |
| --- | --- | --- |
| `transcriptId` | Non-empty string | Required when `resolution` is present; equal to `partner.transcript.id`. |
| `chromosome` | Non-empty string | Required; equal to the partner chromosome (with `chr` prefix differences normalized). |
| `position` | Positive integer | Required; equal to the partner `breakpoint`. |
| `strand` | `"+"` or `"-"` | Required; equal to the partner strand. |
| `region` | `"exon"`, `"intron"`, or `"outside"` | Required. Choose the location category rather than guessing. |
| `codingRegion` | `"cds"`, `"utr"`, `"noncoding"`, or `"unknown"` | Required; use `"unknown"` when annotation does not establish it. |
| `exonNumber` | Positive integer | Required only when `region` is `"exon"`; use the transcript exon number. |
| `exonOffset` | Positive integer | Optional only for an exon; 1-based offset in transcript direction (`position - start + 1` on `+`, `end - position + 1` on `-`). Requires `exonNumber`. |
| `intronNumber` | Positive integer | Required only when `region` is `"intron"`; number the intron by transcript direction. |
| `breakpointLocation` | `"boundary"` or `"interior"` | Optional only for an exon; use `"boundary"` at an exon edge and `"interior"` inside the exon. |
| `cytoband` | Non-empty string | Optional cytoband label for this breakpoint. |

When biological exon coordinates are supplied, make `region`, the exon/intron number, and `exonOffset` agree with those coordinates. Never send a partial `resolution` object: omit it until all six base fields are known.


## Call the API

Resolve the API base URL in this order:

1. Use a base URL explicitly provided by the user.
2. Otherwise use the live production deployment at `https://fusiondraw.biotools.space`.
3. If the production endpoint is unavailable and local development is in scope, use the currently running local FusionDraw server.

The endpoint is:

```text
POST {baseUrl}/api/render-svg
Content-Type: application/json
```

The live production endpoint is `https://fusiondraw.biotools.space/api/render-svg`. For local development, the default Vite URL is `http://127.0.0.1:5173`; if that port is occupied, use the URL printed by `pnpm dev` (Vite may select the next available port). If no local server is running and starting local development is within the user's request, run `pnpm dev` and use its reported URL.

Treat the response according to its status and content type:

- `200` with `image/svg+xml`: return the SVG or save the exact response as the requested `.svg` file. Verify that the response contains an `<svg` root before claiming success.
- `400` with JSON: report the relevant validation message and ask the user for the missing or corrected field; do not blindly retry the same payload.
- `405`: use `POST` or `OPTIONS`; do not use `GET` for rendering.
- `500` or a connection error: report the status and response details, and do not blindly retry. Use the local server only when local development is explicitly in scope and the production endpoint is unavailable.

Do not claim that this endpoint produced PNG/JPG or that it validated a diagnosis. It produces an SVG research illustration from the supplied PlotSpec.
