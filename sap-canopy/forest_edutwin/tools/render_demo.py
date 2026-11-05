"""
Render the SAP Forest EduTwin demo figures.

These are the visuals for the README, the demo video and launch posts. They
are produced from the *live calibrated model* (scenarios.apply_calibration),
so what you see here is exactly what the app shows — not a redrawn mock-up.

Outputs (default: ../assets/demo/):
    canopy_growth.png        canopy cover (%) vs year, mangrove vs urban
    cumulative_carbon.png    cumulative carbon (tCO2e/ha) vs year
    year15_comparison.png    year-15 endpoint bars + the published SAP graph
    calibration_proof.png    raw model vs published reference vs calibrated
    growth_storyboard.png    4-frame progression for the demo video
    demo_sheet.png           one hero sheet with all of the above

Usage:
    python tools/render_demo.py
    python tools/render_demo.py --out DIR
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np  # noqa: E402

HERE = Path(__file__).resolve().parent
PKG = HERE.parent
sys.path.insert(0, str(PKG))

import scenarios as sc  # noqa: E402

# --- Treegens / MiroFish palette --------------------------------------------
BG = "#0b0f14"
PANEL = "#111922"
BORDER = "#223141"
TEXT = "#e6edf5"
MUTED = "#8fa3b8"
GREEN = "#2d8a4e"       # mangrove
GREEN_BRIGHT = "#4caf50"
BLUE = "#4a90d9"        # urban
BLUE_BRIGHT = "#5aa9ff"
AMBER = "#e0a458"
GRID = "#1b2735"

plt.rcParams.update({
    "figure.facecolor": BG,
    "axes.facecolor": PANEL,
    "savefig.facecolor": BG,
    "text.color": TEXT,
    "axes.labelcolor": TEXT,
    "axes.edgecolor": BORDER,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "grid.color": GRID,
    "font.size": 10,
    "axes.titlesize": 13,
    "axes.titleweight": "bold",
    "legend.frameon": False,
})

FOOTER = ("Illustrative averages, not site-specific predictions · "
          "curves digitised from the published SAP graphs · "
          "Treegens Proof of Tree + NVIDIA Omniverse/Cosmos")


def _style(ax, title, xlabel, ylabel):
    ax.set_title(title, color=TEXT, pad=14)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.grid(True, alpha=0.55, linewidth=0.7)
    ax.set_axisbelow(True)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)


def _footer(fig):
    fig.text(0.5, 0.012, FOOTER, ha="center", va="bottom", color=MUTED, fontsize=7.5)


def _curves(key):
    rows = sc.apply_calibration(sc.project(key, 1.0, 15, 1.0), None, key)
    years = [r["year"] for r in rows]
    return years, [r["canopy_pct"] for r in rows], [r["carbon_tco2e"] for r in rows]


def _reference(key):
    cal = sc.default_calibration() or []
    ref = sorted([c for c in cal if c["scenario"] == key], key=lambda c: c["year"])
    return [c["year"] for c in ref], [c["canopy_pct"] for c in ref], [c["carbon_tco2e"] for c in ref]


def chart_canopy(out: Path):
    fig, ax = plt.subplots(figsize=(9, 5.2), dpi=150)
    for key, colour, label, style in (
        ("mangrove", GREEN_BRIGHT, "Mangrove restoration", "-"),
        ("urban", BLUE_BRIGHT, "Urban street canopy", "--"),
    ):
        years, canopy, _ = _curves(key)
        ax.plot(years, canopy, style, color=colour, linewidth=2.6,
                label=label, marker="o", markersize=4)
        ry, rc, _ = _reference(key)
        ax.plot(ry, rc, ":", color=colour, alpha=0.65, linewidth=1.5,
                label="published SAP graph (digitised)")
    ax.set_ylim(0, 100)
    ax.set_xticks(range(0, 16, 2))
    _style(ax, "15-year canopy growth projection — 1 hectare",
           "Years since planting", "Canopy cover (%)")
    ax.legend(loc="upper left", fontsize=9, ncol=1)
    _footer(fig)
    fig.tight_layout(rect=(0, 0.035, 1, 1))
    fig.savefig(out)
    plt.close(fig)
    return out


def chart_carbon(out: Path):
    fig, ax = plt.subplots(figsize=(9, 5.2), dpi=150)
    for key, colour, label, style in (
        ("mangrove", GREEN_BRIGHT, "Mangrove restoration", "-"),
        ("urban", BLUE_BRIGHT, "Urban street canopy", "--"),
    ):
        years, _, carbon = _curves(key)
        ax.plot(years, carbon, style, color=colour, linewidth=2.6,
                label=label, marker="o", markersize=4)
        ry, _, rk = _reference(key)
        ax.plot(ry, rk, ":", color=colour, alpha=0.65, linewidth=1.5,
                label="published SAP graph (digitised)")
    ax.set_ylim(0, 460)
    ax.set_xticks(range(0, 16, 2))
    _style(ax, "Cumulative carbon storage — 1 hectare",
           "Years since planting", "Carbon stored (t CO₂e per hectare)")
    ax.legend(loc="upper left", fontsize=9)
    _footer(fig)
    fig.tight_layout(rect=(0, 0.035, 1, 1))
    fig.savefig(out)
    plt.close(fig)
    return out


def chart_year15(out: Path):
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4.8), dpi=150)
    my, mc, mk = _curves("mangrove")
    uy, uc, uk = _curves("urban")

    bars = ax1.bar(["Mangrove", "Urban"], [mc[-1], uc[-1]],
                    color=[GREEN, BLUE], width=0.55)
    ax1.set_ylim(0, 100)
    for b, v in zip(bars, [mc[-1], uc[-1]]):
        ax1.text(b.get_x() + b.get_width() / 2, v + 2, f"{v:.1f}%",
                 ha="center", color=TEXT, fontweight="bold", fontsize=12)
    _style(ax1, "Year 15 canopy cover", "", "Canopy cover (%)")
    ax1.tick_params(axis="x", labelsize=11)

    bars = ax2.bar(["Mangrove", "Urban"], [mk[-1], uk[-1]],
                    color=[GREEN, BLUE], width=0.55)
    ax2.set_ylim(0, 500)
    for b, v in zip(bars, [mk[-1], uk[-1]]):
        ax2.text(b.get_x() + b.get_width() / 2, v + 10, f"{v:,.0f}",
                 ha="center", color=TEXT, fontweight="bold", fontsize=12)
    _style(ax2, "Year 15 illustrative CO₂e", "", "t CO₂e per hectare")
    ax2.tick_params(axis="x", labelsize=11)

    fig.suptitle("SAP Forest EduTwin — 15-year endpoints",
                 color=TEXT, fontsize=15, fontweight="bold", y=0.99)
    _footer(fig)
    fig.tight_layout(rect=(0, 0.04, 1, 0.95))
    fig.savefig(out)
    plt.close(fig)
    return out


def chart_calibration_proof(out: Path):
    """Raw model vs published reference vs calibrated output."""
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4.8), dpi=150)
    for key, colour, label in (
        ("mangrove", GREEN_BRIGHT, "Mangrove"),
        ("urban", BLUE_BRIGHT, "Urban"),
    ):
        raw = sc.project(key, 1.0, 15, 1.0)
        ry, rc, rk = _reference(key)
        cal = sc.apply_calibration(raw, None, key)

        ax1.plot([r["year"] for r in raw], [r["canopy_pct"] for r in raw],
                 color=colour, alpha=0.32, linewidth=2, linestyle="--",
                 label=f"{label} — raw model")
        ax1.plot(ry, rc, ":", color=colour, linewidth=2.4,
                 label=f"{label} — published SAP graph")
        ax1.plot([r["year"] for r in cal], [r["canopy_pct"] for r in cal],
                 color=colour, linewidth=2.6, marker="o", markersize=3.5,
                 label=f"{label} — calibrated (what the app shows)")

        ax2.plot([r["year"] for r in raw], [r["carbon_tco2e"] for r in raw],
                 color=colour, alpha=0.32, linewidth=2, linestyle="--")
        ax2.plot(ry, rk, ":", color=colour, linewidth=2.4)
        ax2.plot([r["year"] for r in cal], [r["carbon_tco2e"] for r in cal],
                 color=colour, linewidth=2.6, marker="o", markersize=3.5)

    ax1.set_ylim(0, 100)
    ax2.set_ylim(0, 460)
    for ax, title, ylabel in (
        (ax1, "Canopy: model → published → calibrated", "Canopy cover (%)"),
        (ax2, "Carbon: model → published → calibrated", "t CO₂e per hectare"),
    ):
        ax.set_xticks(range(0, 16, 2))
        _style(ax, title, "Years since planting", ylabel)
    ax1.legend(loc="upper left", fontsize=7.4, ncol=1)
    fig.suptitle("Why the calibration is a correction factor, not an overwrite",
                 color=TEXT, fontsize=14, fontweight="bold", y=0.99)
    _footer(fig)
    fig.tight_layout(rect=(0, 0.04, 1, 0.95))
    fig.savefig(out)
    plt.close(fig)
    return out


def chart_storyboard(out: Path):
    """Four frames a screen-recorder can pan across — the demo-video spine."""
    frames = [(0, "Day 0 — planted"), (5, "Year 5"), (10, "Year 10"), (15, "Year 15")]
    fig, axes = plt.subplots(1, 4, figsize=(13.5, 3.9), dpi=150)
    for ax, (year, label) in zip(axes, frames):
        years, canopy, carbon = _curves("mangrove")
        upto = [i for i, y in enumerate(years) if y <= year]
        xs = [years[i] for i in upto]
        ys = [canopy[i] for i in upto]
        cs = [carbon[i] for i in upto]

        ax.barh([0], [ys[-1]], color=GREEN, height=0.55, alpha=0.9)
        ax.barh([-1], [cs[-1] / 460], color=AMBER, height=0.55, alpha=0.85)
        ax.set_xlim(0, 100)
        ax.set_ylim(-1.6, 0.6)
        ax.set_yticks([])
        ax.set_xticks([0, 50, 100])
        ax.set_title(f"{label}\n{ys[-1]:.1f}% canopy · {cs[-1]:,.0f} t CO₂e/ha",
                     color=TEXT, fontsize=10.5, fontweight="bold")
        ax.grid(True, axis="x", alpha=0.4, linewidth=0.6)
        ax.set_axisbelow(True)
        for s in ("top", "right", "left"):
            ax.spines[s].set_visible(False)
        ax.text(0.5, -1.45, "carbon →" if year == 0 else "",
                color=AMBER, fontsize=8, transform=ax.transData)
    fig.suptitle("Mangrove restoration — 15 years on 1 hectare",
                 color=TEXT, fontsize=14, fontweight="bold", y=1.0)
    _footer(fig)
    fig.tight_layout(rect=(0, 0.05, 1, 0.93))
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    return out


def chart_sheet(out: Path, parts: list[Path]):
    """One hero sheet: the hero panels stacked, for README / social posts."""
    from PIL import Image

    imgs = [Image.open(p) for p in parts]
    width = max(i.width for i in imgs)
    scaled = []
    for i in imgs:
        if i.width == width:
            scaled.append(i)
        else:
            h = int(i.height * width / i.width)
            scaled.append(i.resize((width, h), Image.LANCZOS))
    height = sum(i.height for i in scaled)
    sheet = Image.new("RGB", (width, height), BG)
    y = 0
    for i in scaled:
        sheet.paste(i, (0, y))
        y += i.height
    sheet.save(out)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(PKG.parent / "assets" / "demo"))
    args = ap.parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    made = [
        chart_canopy(out_dir / "canopy_growth.png"),
        chart_carbon(out_dir / "cumulative_carbon.png"),
        chart_year15(out_dir / "year15_comparison.png"),
        chart_calibration_proof(out_dir / "calibration_proof.png"),
        chart_storyboard(out_dir / "growth_storyboard.png"),
    ]
    sheet = chart_sheet(out_dir / "demo_sheet.png", made)
    made.append(sheet)

    for p in made:
        print(f"  {p}  ({p.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
