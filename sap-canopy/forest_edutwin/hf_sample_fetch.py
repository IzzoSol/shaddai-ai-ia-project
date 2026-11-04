"""
SAP Forest EduTwin — selective Hugging Face sample fetcher
===========================================================
Downloads only what the demo needs, in small pieces, so an 8 GB laptop never
pulls a 100 GB dataset.

What it fetches
  1. NVIDIA SimReady assets (OpenUSD packages)   -> optional, USD only, few files
  2. Web-ready GLB conversions of SimReady        -> already vendored, re-fetch on demand
  3. CAD sample (CADFS test index)               -> ~110 KB
  4. CADGenBench edit prompt sample              -> ~50 B
  5. Zero-To-CAD-1m                              -> STREAMED (one row, no full download)
  6. GaussianWorld scene_splat_49k               -> gated, only with HF_TOKEN

Usage
  python hf_sample_fetch.py            # small files only
  python hf_sample_fetch.py --stream   # also stream 1 row from Zero-To-CAD-1m
  python hf_sample_fetch.py --gated    # also try gated datasets (needs HF_TOKEN)
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT.parent / "assets"
PLOT = ASSETS / "plot"
DATA = ASSETS / "data"

PLOT.mkdir(parents=True, exist_ok=True)
DATA.mkdir(parents=True, exist_ok=True)

HF_FILES = [
    # (repo_id, repo_type, path_in_repo, local_name)
    ("codepawl/simready-glb", "dataset", "glb/barrier_fence_metal_a02.glb", PLOT / "barrier_fence_metal_a02.glb"),
    ("codepawl/simready-glb", "dataset", "glb/crate_plywood_a04.glb", PLOT / "crate_plywood_a04.glb"),
    ("codepawl/simready-glb", "dataset", "glb/bin_waste_a01.glb", PLOT / "bin_waste_a01.glb"),
    ("VladPyatov/CADFS", "dataset", "cadfs/test_data/CADFS_test.json", DATA / "CADFS_test.json"),
    ("HuggingAI4Engineering/cadgenbench-data", "dataset", "246/edit_description.txt",
     DATA / "cadgenbench_246_edit_description.txt"),
    ("HuggingAI4Engineering/cadgenbench-data", "dataset", "README.md", DATA / "cadgenbench_README.md"),
]

GATED_FILES = [
    ("GaussianWorld/scene_splat_49k", "dataset", "statistics/arkitscenes_3dgs_runs.csv",
     DATA / "arkitscenes_3dgs_runs.csv"),
]


def download_direct(repo_id, repo_type, path, dest):
    from huggingface_hub import hf_hub_download
    print(f"-> {repo_id}/{path}")
    try:
        got = hf_hub_download(repo_id=repo_id, repo_type=repo_type, filename=path,
                              local_dir=str(dest.parent))
        size = Path(got).stat().st_size
        print(f"   ok ({size:,} bytes)")
        return True
    except Exception as e:
        print(f"   skipped: {e}")
        return False


def stream_zero_to_cad():
    """One row from Zero-To-CAD-1m without downloading the parquet shards."""
    print("-> streaming one row from 0x3/Zero-To-CAD-1m (no full download)")
    try:
        from datasets import load_dataset
        ds = load_dataset("0x3/Zero-To-CAD-1m", split="train", streaming=True)
        row = next(iter(ds))
        out = DATA / "zero_to_cad_row.json"
        import json
        out.write_text(json.dumps({k: (str(v)[:2000] if not isinstance(v, (int, float, str)) else v)
                                   for k, v in row.items()}, indent=2), encoding="utf-8")
        print(f"   ok -> {out} (keys: {list(row.keys())[:8]})")
        return True
    except Exception as e:
        print(f"   skipped: {e}")
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stream", action="store_true", help="also stream a Zero-To-CAD row")
    ap.add_argument("--gated", action="store_true", help="also fetch gated datasets (needs HF_TOKEN)")
    args = ap.parse_args()

    print("SAP Forest EduTwin — Hugging Face sample fetch")
    print("=" * 58)
    ok = 0
    for repo_id, repo_type, path, dest in HF_FILES:
        if dest.exists():
            print(f"-> {dest.name}: already present ({dest.stat().st_size:,} bytes)")
            ok += 1
            continue
        ok += 1 if download_direct(repo_id, repo_type, path, dest) else 0

    if args.stream:
        stream_zero_to_cad()

    if args.gated:
        if not os.environ.get("HF_TOKEN"):
            print("! gated fetch requested but HF_TOKEN is not set — skipping")
        else:
            for repo_id, repo_type, path, dest in GATED_FILES:
                if dest.exists():
                    print(f"-> {dest.name}: already present")
                    continue
                download_direct(repo_id, repo_type, path, dest)

    print("=" * 58)
    print(f"done. {ok}/{len(HF_FILES)} small assets available in {ASSETS}")


if __name__ == "__main__":
    sys.exit(main())
