# Annotation compiler

`build_annotation.py` converts a pinned GENCODE GTF and UCSC cytoband file into the static pack consumed by `StaticAnnotationProvider`.

```bash
python3 annotation-builder/build_annotation.py \
  --gtf gencode.v49.annotation.gtf.gz \
  --cytoband cytoBand.txt \
  --chromosome-lengths chrom.sizes \
  --assembly hg38 \
  --version v49 \
  --output apps/demo/public/annotation/hg38
```

`--chromosome-lengths` accepts a two-column UCSC-style `chrom.sizes` file or a
JSON object. When omitted, lengths are taken from cytobands and annotation
records. The release job must replace the demo fixture manifest with the
concrete GENCODE version and checksums. All emitted coordinates are 1-based
inclusive and output ordering is deterministic. Generated manifests include
the pack checksum and per-shard SHA-256 values; the browser provider verifies
those shard values before caching/using a shard.

For hg19, pass the pinned GENCODE lift37 release that corresponds to the same
annotation major version used for hg38; floating values such as `latest` are
rejected by the compiler.
