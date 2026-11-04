"""
DEPRECATED — superseded by ``hf_sample_fetch.py``.

This early downloader used ``snapshot_download`` with permissive glob patterns,
which could pull far more than the demo needs (the Zero-To-CAD-1m parquet shards
are 68–190 MB each). ``hf_sample_fetch.py`` is safer: it fetches an explicit
allow-list of small files, streams a single row from the large parquet dataset,
and only touches gated datasets when ``HF_TOKEN`` is present.

Kept as a thin shim so existing notes/scripts that reference it still work.

New usage::

    python hf_sample_fetch.py            # small files only
    python hf_sample_fetch.py --stream   # + 1 streamed Zero-To-CAD row
    python hf_sample_fetch.py --gated    # + gated datasets (needs HF_TOKEN)
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
NEW = HERE / "hf_sample_fetch.py"


def main() -> int:
    print("[SAP] assets_downloader.py is deprecated -> forwarding to hf_sample_fetch.py")
    if not NEW.exists():
        print(f"[SAP] missing {NEW}")
        return 1
    return subprocess.call([sys.executable, str(NEW), *sys.argv[1:]])


if __name__ == "__main__":
    sys.exit(main())
