import sys
import subprocess
import tempfile
import unittest
import gzip
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_annotation import normalize_records, parse_chromosome_lengths, parse_cytoband  # noqa: E402


class AnnotationCompilerTest(unittest.TestCase):
    def test_gencode_transcript_tags_are_normalized_and_merged(self):
        gtf = """##gtf-version 3
chr1\tsource\tgene\t1\t1000\t.\t-\t.\tgene_id \"G1\"; gene_name \"TAGGED\";
chr1\tsource\texon\t1\t100\t.\t-\t.\tgene_id \"G1\"; gene_name \"TAGGED\"; transcript_id \"TX1\"; exon_number \"2\"; tag \"Ensembl_canonical\";
chr1\tsource\ttranscript\t1\t1000\t.\t-\t.\tgene_id \"G1\"; gene_name \"TAGGED\"; transcript_id \"TX1\"; transcript_name \"TAGGED-201\"; tag \"MANE_Select\"; tag \"MANE_Plus_Clinical\"; tag \"appris_principal_1\";
chr1\tsource\texon\t900\t1000\t.\t-\t.\tgene_id \"G1\"; gene_name \"TAGGED\"; transcript_id \"TX1\"; exon_number \"1\"; ccds_id \"CCDS1\";
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "tagged.gtf"
            path.write_text(gtf, encoding="utf-8")
            records, _ = normalize_records(path)
        transcript = records[0]["transcripts"][0]
        self.assertTrue(transcript["canonical"])
        self.assertTrue(transcript["maneSelect"])
        self.assertTrue(transcript["manePlusClinical"])
        self.assertIn("appris_principal", transcript["appris"])
        self.assertTrue(transcript["ccds"])

    def test_repeated_appris_attributes_remain_rankable(self):
        gtf = """chr1\tsource\tgene\t1\t100\t.\t+\t.\tgene_id \"G1\"; gene_name \"APPRIS_MULTI\";
chr1\tsource\ttranscript\t1\t100\t.\t+\t.\tgene_id \"G1\"; transcript_id \"TX1\"; appris_principal \"1\"; appris_principal \"2\";
chr1\tsource\texon\t1\t100\t.\t+\t.\tgene_id \"G1\"; transcript_id \"TX1\"; exon_number \"1\";
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "appris-multi.gtf"
            path.write_text(gtf, encoding="utf-8")
            records, _ = normalize_records(path)
        self.assertIn("appris_principal_1", records[0]["transcripts"][0]["appris"])
        self.assertIn("appris_principal_2", records[0]["transcripts"][0]["appris"])

    def test_non_principal_appris_tags_are_preserved(self):
        gtf = """chr1\tsource\tgene\t1\t100\t.\t+\t.\tgene_id \"G1\"; gene_name \"APPRIS_ALL\";
chr1\tsource\ttranscript\t1\t100\t.\t+\t.\tgene_id \"G1\"; transcript_id \"TX1\"; tag \"appris_alternative_2\";
chr1\tsource\texon\t1\t100\t.\t+\t.\tgene_id \"G1\"; transcript_id \"TX1\"; exon_number \"1\";
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "appris-all.gtf"
            path.write_text(gtf, encoding="utf-8")
            records, _ = normalize_records(path)
        self.assertEqual(records[0]["transcripts"][0]["appris"], "appris_alternative_2")

    def test_chromosome_lengths_accept_ucsc_tsv(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "chrom.sizes"
            path.write_text("chr1 248956422\nchrM 16569\n", encoding="utf-8")
            self.assertEqual(parse_chromosome_lengths(path)["chr1"], 248956422)

    def test_chromosome_names_and_numeric_appris_values_are_normalized(self):
        gtf = """1\tsource\tgene\t1\t100\t.\t+\t.\tgene_id \"G1\"; gene_name \"NORM\";\n1\tsource\ttranscript\t1\t100\t.\t+\t.\tgene_id \"G1\"; transcript_id \"TX1\"; appris_principal \"1\";\n1\tsource\texon\t1\t100\t.\t+\t.\tgene_id \"G1\"; transcript_id \"TX1\"; exon_number \"1\";\n"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "normalization.gtf"
            path.write_text(gtf, encoding="utf-8")
            records, lengths = normalize_records(path)
        self.assertEqual(records[0]["chromosome"], "chr1")
        self.assertEqual(lengths["chr1"], 100)
        self.assertEqual(records[0]["transcripts"][0]["appris"], "appris_principal_1")

    def test_compiler_output_is_byte_deterministic(self):
        root = Path(__file__).parent
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first"
            second = Path(directory) / "second"
            command = [
                sys.executable, str(root / "build_annotation.py"),
                "--gtf", str(root / "fixtures" / "minimal.gtf"),
                "--cytoband", str(root / "fixtures" / "cytoband.txt"),
                "--assembly", "hg38", "--version", "fixture", "--output",
            ]
            subprocess.run([*command, str(first)], check=True)
            subprocess.run([*command, str(second)], check=True)
            first_files = sorted(path.name for path in first.iterdir())
            self.assertEqual(first_files, sorted(path.name for path in second.iterdir()))
            self.assertTrue(any(name.startswith("chr1-") for name in first_files))
            for name in first_files:
                self.assertEqual((first / name).read_bytes(), (second / name).read_bytes(), name)

    def test_compiler_rejects_floating_version(self):
        root = Path(__file__).parent
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([
                sys.executable, str(root / "build_annotation.py"),
                "--gtf", str(root / "fixtures" / "minimal.gtf"),
                "--cytoband", str(root / "fixtures" / "cytoband.txt"),
                "--assembly", "hg38", "--version", "latest", "--output", directory,
            ], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("pinned", result.stderr)

    def test_overlapping_cds_rows_are_unioned_once(self):
        gtf = """chr1\tsource\tgene\t1\t200\t.\t+\t.\tgene_id \"G1\"; gene_name \"CDS\";
chr1\tsource\ttranscript\t1\t200\t.\t+\t.\tgene_id \"G1\"; transcript_id \"TX1\";
chr1\tsource\texon\t1\t200\t.\t+\t.\tgene_id \"G1\"; transcript_id \"TX1\"; exon_number \"1\";
chr1\tsource\tCDS\t20\t100\t.\t+\t0\tgene_id \"G1\"; transcript_id \"TX1\";
chr1\tsource\tCDS\t80\t150\t.\t+\t0\tgene_id \"G1\"; transcript_id \"TX1\";
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "overlap.gtf"
            path.write_text(gtf, encoding="utf-8")
            records, _ = normalize_records(path)
        transcript = records[0]["transcripts"][0]
        self.assertEqual(transcript["cdsLength"], 131)
        self.assertEqual(transcript["exons"][0]["cdsStart"], 20)
        self.assertEqual(transcript["exons"][0]["cdsEnd"], 150)

    def test_overlapping_cytobands_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad-cytoband.txt"
            path.write_text("chr1\t0\t10\tp11\tgneg\nchr1\t9\t20\tp12\tgpos50\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                parse_cytoband(path)

    def test_gzip_cytoband_and_chromosome_length_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cytoband = root / "cyto.txt.gz"
            with gzip.open(cytoband, "wt", encoding="utf-8") as handle:
                handle.write("chr1\t0\t10\tp11\tgneg\n")
            self.assertEqual(parse_cytoband(cytoband)[0][0]["bands"][0]["start"], 1)
            lengths = root / "chrom.json.gz"
            with gzip.open(lengths, "wt", encoding="utf-8") as handle:
                json.dump({"chr1": 248956422}, handle)
            self.assertEqual(parse_chromosome_lengths(lengths)["chr1"], 248956422)


if __name__ == "__main__":
    unittest.main()
