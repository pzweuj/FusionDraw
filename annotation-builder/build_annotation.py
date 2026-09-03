#!/usr/bin/env python3
"""Compile a GTF and UCSC cytoband file into deterministic FusionView shards.

This intentionally uses only the Python standard library so it can run in CI and
in an offline release job. GTF coordinates and the emitted pack are 1-based,
inclusive; UCSC cytoband starts are converted from 0-based half-open coordinates.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Optional


def without_none(value):
    if isinstance(value, dict):
        return {key: without_none(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [without_none(item) for item in value]
    return value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_chromosome(chromosome: str) -> str:
    """Emit UCSC-style chromosome names consistently across all pack files."""
    raw = str(chromosome).strip()
    if raw.lower().startswith("chr"):
        raw = raw[3:]
    if raw.lower() in {"m", "mt"}:
        return "chrM"
    if not raw:
        raise ValueError("Chromosome name must not be empty")
    return f"chr{raw}"


def pack_checksum(directory: Path, names: list[str]) -> str:
    digest = hashlib.sha256()
    for name in sorted(names):
        path = directory / name
        if not path.is_file(): continue
        digest.update(path.name.encode("utf-8")); digest.update(b"\0"); digest.update(path.read_bytes())
    return digest.hexdigest()


def attrs(raw: str) -> dict[str, str]:
    result: dict[str, str] = {}
    # GTF attributes are normally quoted, but accepting a bare token as well
    # makes the compiler tolerant of small fixture/export differences.  Only
    # repeated metadata fields are joined; scalar fields retain the first
    # value, matching GENCODE's deterministic semantics.
    pattern = re.compile(r"([\w.-]+)\s+(?:\"((?:\\.|[^\"])*)\"|([^;\s]+))")
    repeatable = {"tag", "appris_principal", "ccds_id", "ccdsid"}
    for match in pattern.finditer(raw):
        key = match.group(1)
        value = match.group(2) if match.group(2) is not None else match.group(3)
        value = re.sub(r"\\([\\\"'])", r"\1", value)
        if (key in repeatable or key.startswith("appris_principal_")) and key in result:
            result[key] = f"{result[key]},{value}"
        elif key not in result:
            result[key] = value
    return result


def tags(raw: str) -> set[str]:
    """Return normalized GTF tag values.

    GENCODE emits values such as ``Ensembl_canonical`` and
    ``appris_principal_1`` as repeated ``tag`` attributes.  Normalizing case
    and punctuation here keeps ranking logic independent of the exact spelling
    used by a source release.
    """
    values = re.split(r"[,;\s]+", raw or "")
    return {
        re.sub(r"[^a-z0-9]+", "_", item.strip(' \"').lower()).strip("_")
        for item in values
        if item.strip(' \"')
    }


def normalize_appris_value(value: str) -> str:
    """Normalize APPRIS spellings to a stable value used by the resolver."""
    normalized = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    if normalized.isdigit():
        return f"appris_principal_{normalized}"
    match = re.fullmatch(r"(?:appris_)?principal_?(\d+)?", normalized)
    if match:
        return f"appris_principal_{match.group(1)}" if match.group(1) else "appris_principal"
    return normalized


def truthy_attribute(value: Optional[str]) -> bool:
    """Interpret the boolean-like metadata spellings used by GTF exports."""
    return bool(value and value.strip().lower() in {"1", "true", "yes", "y"})


def open_text(path: Path):
    return gzip.open(path, "rt", encoding="utf-8") if path.suffix.lower() == ".gz" else path.open("rt", encoding="utf-8")


def merge_intervals(intervals: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Return sorted, non-overlapping inclusive intervals."""
    merged: list[list[int]] = []
    for start, end in sorted(set(intervals)):
        if not merged or start > merged[-1][1] + 1:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)
    return [(start, end) for start, end in merged]


def normalize_records(path: Path) -> tuple[list[dict], dict[str, int]]:
    # A second compact parser keeps association and CDS/exon data explicit.
    genes: dict[str, dict] = {}
    transcripts: dict[tuple[str, str], dict] = {}
    cds_ranges: dict[tuple[str, str], list[tuple[int, int]]] = defaultdict(list)
    lengths: dict[str, int] = {}
    with open_text(path) as handle:
        for line in handle:
            if not line.strip() or line.lstrip().startswith("#"): continue
            fields = line.rstrip("\r\n").split("\t")
            if len(fields) != 9: continue
            chrom, _, feature, start, end, _, strand, _, raw = fields
            feature = feature.strip().lower()
            chrom = normalize_chromosome(chrom.strip())
            strand = strand.strip()
            start_i, end_i = int(start), int(end); data = attrs(raw)
            gene_id = (data.get("gene_id") or "").strip()
            if start_i < 1 or end_i < start_i:
                raise ValueError(f"Invalid GTF interval: {chrom}:{start}-{end}")
            if strand not in {"+", "-"}:
                raise ValueError(f"Invalid GTF strand for {chrom}:{start}-{end}: {strand}")
            if not gene_id: continue
            lengths[chrom] = max(lengths.get(chrom, 0), end_i)
            gene_symbol = (data.get("gene_name") or gene_id).strip()
            gene = genes.setdefault(gene_id, {"id": gene_id, "symbol": gene_symbol, "chromosome": chrom, "start": start_i, "end": end_i, "strand": strand, "transcripts": []})
            if gene["chromosome"] != chrom or gene["strand"] != strand:
                raise ValueError(f"Gene {gene_id} has inconsistent chromosome or strand")
            gene["start"] = min(gene["start"], start_i); gene["end"] = max(gene["end"], end_i)
            if gene_symbol and gene.get("symbol") == gene_id:
                gene["symbol"] = gene_symbol
            if feature == "gene": continue
            transcript_id = (data.get("transcript_id") or "").strip()
            if not transcript_id: continue
            key = (gene_id, transcript_id)
            transcript = transcripts.setdefault(key, {"id": transcript_id, "displayName": data.get("transcript_name"), "start": start_i, "end": end_i, "strand": strand, "biotype": data.get("transcript_type") or data.get("transcript_biotype"), "canonical": False, "maneSelect": False, "manePlusClinical": False, "appris": None, "ccds": False, "cdsLength": 0, "exons": []})
            if transcript["strand"] != strand:
                raise ValueError(f"Transcript {transcript_id} has inconsistent strand")
            transcript["start"] = min(transcript["start"], start_i); transcript["end"] = max(transcript["end"], end_i)
            # Metadata is repeated on transcript/exon/CDS rows in different
            # GENCODE releases, so merge it on every feature instead of relying
            # on the first row encountered.
            record_tags = tags(data.get("tag", ""))
            transcript["canonical"] = transcript["canonical"] or bool({"canonical", "ensembl_canonical"} & record_tags) \
                or truthy_attribute(data.get("canonical")) or truthy_attribute(data.get("ensembl_canonical"))
            transcript["maneSelect"] = transcript["maneSelect"] or "mane_select" in record_tags \
                or truthy_attribute(data.get("mane_select"))
            transcript["manePlusClinical"] = transcript["manePlusClinical"] or "mane_plus_clinical" in record_tags \
                or truthy_attribute(data.get("mane_plus_clinical"))
            # Keep the complete APPRIS annotation (principal, alternative,
            # candidate, reliable, …), while the resolver independently
            # recognizes only principal values for ranking.  This preserves
            # source metadata instead of reducing it to a single boolean.
            appris_values = {
                normalize_appris_value(tag)
                for tag in record_tags
                if tag.startswith("appris_") or re.fullmatch(r"principal_?\d*", tag)
            }
            appris_attributes = [value for key, value in data.items() if key.startswith("appris_")]
            for appris_attribute in appris_attributes:
                for raw_appris in re.split(r"[,;]", appris_attribute):
                    appris_value = raw_appris.strip()
                    if not appris_value:
                        continue
                    normalized_appris = normalize_appris_value(appris_value)
                    if normalized_appris:
                        appris_values.add(normalized_appris)
            if appris_values:
                transcript["appris"] = ",".join(sorted(appris_values))
            transcript["ccds"] = transcript["ccds"] or bool(data.get("ccds_id") or data.get("ccdsid")) \
                or truthy_attribute(data.get("ccds")) or any(tag.startswith("ccds") for tag in record_tags)
            if not transcript.get("displayName") and data.get("transcript_name"):
                transcript["displayName"] = data["transcript_name"]
            if not transcript.get("biotype") and (data.get("transcript_type") or data.get("transcript_biotype")):
                transcript["biotype"] = data.get("transcript_type") or data.get("transcript_biotype")
            if feature == "exon":
                exon_number = int(data.get("exon_number", len(transcript["exons"]) + 1))
                if exon_number < 1:
                    raise ValueError(f"Invalid exon number for {transcript_id}: {exon_number}")
                exon = {"id": data.get("exon_id"), "start": start_i, "end": end_i, "exonNumber": exon_number}
                duplicate = next((item for item in transcript["exons"] if item["start"] == start_i and item["end"] == end_i and item["exonNumber"] == exon_number), None)
                if duplicate is None:
                    transcript["exons"].append(exon)
                elif exon.get("id") and (not duplicate.get("id") or exon["id"] < duplicate["id"]):
                    # Keep duplicate GTF rows deterministic even when their
                    # exon_id attributes differ across source lines.
                    duplicate["id"] = exon["id"]
            elif feature == "cds":
                if (start_i, end_i) not in cds_ranges[key]:
                    cds_ranges[key].append((start_i, end_i))
    for (gene_id, _), transcript in transcripts.items(): genes[gene_id]["transcripts"].append(transcript)
    for gene in genes.values():
        gene["transcripts"].sort(key=lambda item: item["id"])
        for transcript in gene["transcripts"]:
            transcript["exons"].sort(key=lambda item: (item["start"], item["end"]))
            seen_numbers: set[int] = set()
            for index, exon in enumerate(transcript["exons"]):
                if exon["exonNumber"] in seen_numbers:
                    raise ValueError(f"Duplicate exon number in transcript {transcript['id']}: {exon['exonNumber']}")
                seen_numbers.add(exon["exonNumber"])
                if index > 0 and exon["start"] <= transcript["exons"][index - 1]["end"]:
                    raise ValueError(f"Overlapping exons in transcript {transcript['id']}")
            ranges = merge_intervals(cds_ranges.get((gene["id"], transcript["id"]), []))
            transcript["cdsLength"] = sum(end - start + 1 for start, end in ranges)
            for exon in transcript["exons"]:
                overlaps = [(max(start, exon["start"]), min(end, exon["end"])) for start, end in ranges if start <= exon["end"] and end >= exon["start"]]
                if overlaps:
                    exon["cdsStart"] = min(item[0] for item in overlaps); exon["cdsEnd"] = max(item[1] for item in overlaps)
    return sorted(genes.values(), key=lambda item: (item["chromosome"], item["start"], item["id"])), lengths


def parse_cytoband(path: Path) -> tuple[list[dict], dict[str, int]]:
    bands: dict[str, list[dict]] = defaultdict(list); lengths: dict[str, int] = {}
    with open_text(path) as handle:
        for line in handle:
            if not line.strip() or line.lstrip().startswith("#"): continue
            fields = line.rstrip("\r\n").split("\t")
            if len(fields) < 4: continue
            chrom, start, end, name = fields[:4]; chrom = normalize_chromosome(chrom); stain = fields[4] if len(fields) > 4 else ""
            if not name.strip():
                raise ValueError(f"Cytoband name must not be empty for {chrom}")
            start_i, end_i = int(start) + 1, int(end)
            if start_i < 1 or end_i < start_i:
                raise ValueError(f"Invalid cytoband interval: {chrom}:{start}-{end}")
            bands[chrom].append({"name": name, "start": start_i, "end": end_i, "stain": stain})
            lengths[chrom] = max(lengths.get(chrom, 0), end_i)
    records = []
    for chrom in sorted(bands):
        ordered = sorted(bands[chrom], key=lambda item: (item["start"], item["end"], item["name"], item["stain"]))
        for index in range(1, len(ordered)):
            if ordered[index]["start"] <= ordered[index - 1]["end"]:
                raise ValueError(f"Overlapping cytobands on {chrom}")
        records.append({"name": chrom, "length": lengths[chrom], "bands": ordered})
    return records, lengths


def parse_chromosome_lengths(path: Path) -> dict[str, int]:
    """Read chromosome lengths from a two-column TSV or a JSON object."""
    # Release sources are often compressed alongside the GTF/cytoband files.
    # Look through a final `.gz` suffix so `chrom.sizes.json.gz` remains a JSON
    # object rather than being interpreted as a two-column text file.
    lower_name = path.name.lower()
    is_json = lower_name.endswith(".json") or lower_name.endswith(".json.gz")
    if is_json:
        with open_text(path) as handle:
            raw = json.load(handle)
        if not isinstance(raw, dict):
            raise ValueError("Chromosome length JSON must be an object.")
        lengths: dict[str, int] = {}
        for name, raw_length in raw.items():
            if isinstance(raw_length, bool) or not isinstance(raw_length, (int, float)) or int(raw_length) != raw_length:
                raise ValueError("Chromosome lengths must be positive integers.")
            lengths[normalize_chromosome(str(name))] = int(raw_length)
        if any(length < 1 for length in lengths.values()): raise ValueError("Chromosome lengths must be positive integers.")
        return lengths
    lengths: dict[str, int] = {}
    with open_text(path) as handle:
        for line in handle:
            if not line.strip() or line.lstrip().startswith("#"): continue
            fields = line.split()
            if len(fields) < 2: continue
            length = int(fields[1])
            if length < 1: raise ValueError("Chromosome lengths must be positive integers.")
            lengths[normalize_chromosome(fields[0])] = length
    return lengths


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gtf", type=Path, required=True)
    parser.add_argument("--cytoband", type=Path, required=True)
    parser.add_argument("--chromosome-lengths", type=Path, help="Optional TSV/JSON chromosome lengths source")
    parser.add_argument("--assembly", required=True)
    parser.add_argument("--version", required=True, help="Pinned GENCODE version, never 'latest' in release output")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--annotation-url", default="")
    args = parser.parse_args()
    assembly_key = args.assembly.strip().lower()
    normalized_assembly = {"37": "hg19", "hg37": "hg19", "grch37": "hg19", "hg19": "hg19", "38": "hg38", "hg38": "hg38", "grch38": "hg38"}.get(assembly_key)
    if normalized_assembly is None and re.match(r"^(?:hg|grch)?37\.", assembly_key): normalized_assembly = "hg19"
    if normalized_assembly is None and re.match(r"^(?:hg|grch)?38\.", assembly_key): normalized_assembly = "hg38"
    if normalized_assembly is None:
        parser.error("--assembly must be hg19 or hg38 for V0.1 packs")
    args.assembly = normalized_assembly
    if not args.version.strip() or "latest" in args.version.strip().lower():
        parser.error("--version must be pinned; floating 'latest' values are not allowed")
    records, gtf_lengths = normalize_records(args.gtf)
    chromosomes, _ = parse_cytoband(args.cytoband)
    explicit_lengths = parse_chromosome_lengths(args.chromosome_lengths) if args.chromosome_lengths else {}
    all_lengths = {**gtf_lengths, **explicit_lengths}
    for chromosome in chromosomes:
        chromosome["length"] = max(chromosome["length"], all_lengths.get(chromosome["name"], 0))
    for chromosome, length in all_lengths.items():
        if not any(item["name"] == chromosome for item in chromosomes): chromosomes.append({"name": chromosome, "length": length, "bands": []})
    chromosomes.sort(key=lambda item: item["name"])
    args.output.mkdir(parents=True, exist_ok=True)
    # A pack directory is an owned build artifact. Remove only JSON files from
    # a previous compiler run so deleted genes/shards cannot remain reachable
    # through a stale static asset.
    for stale in args.output.glob("*.json"):
        stale.unlink()
    shards: dict[str, list[dict]] = defaultdict(list)
    index: list[dict] = []
    records = [without_none(gene) for gene in records]
    for gene in records:
        # Keep the UCSC chromosome prefix in the shard name so pack paths are
        # self-describing (`chr1-<hash>.json`) and line up with the manifest's
        # chromosome-oriented layout.
        shard = f"{gene['chromosome'] or 'unknown'}-{hashlib.sha1(gene['id'].encode()).hexdigest()[:2]}.json"
        shards[shard].append(gene); index.append({"symbol": gene["symbol"], "id": gene["id"], "chromosome": gene["chromosome"], "shard": shard})
    for shard, genes in sorted(shards.items()):
        (args.output / shard).write_text(json.dumps(genes, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    index.sort(key=lambda item: (item["symbol"].lower(), item["id"], item["chromosome"]))
    (args.output / "index.json").write_text(json.dumps(index, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    (args.output / "chromosomes.json").write_text(json.dumps(chromosomes, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    shard_checksums = {name: sha256(args.output / name) for name in sorted(shards)}
    manifest = {"schemaVersion": "0.1", "assembly": args.assembly, "annotationSource": {"name": "GENCODE", "version": args.version, "url": args.annotation_url, "sha256": sha256(args.gtf)}, "cytobandSource": {"name": args.cytoband.name, "sha256": sha256(args.cytoband)}, "coordinateSystem": "1-based-inclusive", "indexUrl": "index.json", "shardPattern": "{shard}", "chromosomeCount": len(chromosomes), "shardChecksums": shard_checksums, "checksum": pack_checksum(args.output, [*shards.keys(), "index.json", "chromosomes.json"])}
    if args.chromosome_lengths:
        manifest["chromosomeLengthSource"] = {"name": args.chromosome_lengths.name, "sha256": sha256(args.chromosome_lengths)}
    (args.output / "manifest.json").write_text(json.dumps(without_none(manifest), ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__": main()
