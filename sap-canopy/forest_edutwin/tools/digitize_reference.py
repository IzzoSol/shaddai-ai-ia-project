"""
Digitise the three SAP reference graphs into ``data/growth_reference.csv``.

The three source PNGs are the published illustrations for this project. They
are vendored in ``data/reference_graphs/`` so the digitisation is reproducible
from a fresh clone:

    canopy_growth.png      "Educational 15-Year Canopy Growth Projection"
                           canopy cover (%) vs years 0-15, mangrove (green) / urban (blue)
    cumulative_carbon.png  "Illustrative Cumulative Carbon Storage"
                           cumulative carbon (tC per hectare) vs years 0-15
    year15_bars.png        "Year 15 Canopy Cover" + "Year 15 Illustrative CO2e"
                           bar cross-check of the year-15 endpoints

Method
------
1.  Recover the pixel->data transform from the axis *tick marks* (dark pixels
    just outside the axes spines). Tick VALUES are read off the rendered axis
    labels (see ``CANOPY_Y_TICKS`` / ``CARBON_Y_TICKS`` below) and assigned to
    the detected ticks in order, then a least-squares line is fitted. This is
    independent of the gridlines, so gridline/legend-box artefacts cannot
    poison the calibration.
2.  Isolate the series by exact matplotlib colour:
        green (0,128,0)    -> mangrove
        blue  (0,0,255)    -> urban
3.  Trace each series with a dynamic program that scores paths by *uncovered
    columns*. The matplotlib legend swatch occupies only ~35 columns, so any
    path that teleports from the swatch to the real curve leaves hundreds of
    columns uncovered and loses. Dashed series still trace correctly because
    their gaps are short.
4.  Sample the chain at each integer year, refine to the sub-pixel centre of
    the drawn line, and extrapolate the dashed tail to year 15.
5.  Cross-check the year-15 endpoints against the bar graph.

Output: ``forest_edutwin/data/growth_reference.csv`` with columns
    scenario,year,canopy_pct,carbon_tco2e,carbon_tc,source

Usage:  python tools/digitize_reference.py [--write] [--pics DIR]
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
PKG = HERE.parent
DATA_DIR = PKG / "data"

#: The reference graphs, vendored so the digitisation works from a fresh clone.
VENDORED_PICS = DATA_DIR / "reference_graphs"

#: Fallback for the author's machine, where the originals live in OneDrive.
LOCAL_PICS = Path(r"C:\Users\Brittany\OneDrive\Pictures")

#: Canonical file names -> the names they had on the author's machine.
GRAPH_FILES = {
    "canopy": ("canopy_growth.png", "image (2).png"),
    "carbon": ("cumulative_carbon.png", "image (1).png"),
    "bars": ("year15_bars.png", "image.png"),
}

SERIES = {
    "mangrove": (0, 128, 0),
    "urban": (0, 0, 255),
}

# --- axis tick values, read off the rendered axis labels ---------------------
CANOPY_Y_TICKS = [100, 80, 60, 40, 20, 0]      # top -> bottom
CARBON_Y_TICKS = [120, 100, 80, 60, 40, 20, 0]  # top -> bottom
X_TICKS = [0, 2, 4, 6, 8, 10, 12, 14]           # left -> right

MAX_JUMP = 14          # max vertical px per single column of movement
GAP_PENALTY = 3.0      # cost per uncovered column (dashed gaps / wrong branch)
JUMP_COST = 1.0        # cost per px of vertical movement


def resolve_graphs(pics: Path | None = None) -> dict:
    """
    Locate the three source PNGs.

    Search order:
      1. an explicit directory (``--pics``)
      2. the vendored copy in ``data/reference_graphs/``
      3. the author's original OneDrive folder

    Returns a mapping of graph key -> resolved Path. Raises if any are missing.
    """
    candidates = []
    if pics:
        candidates.append(Path(pics))
    candidates += [VENDORED_PICS, LOCAL_PICS]

    resolved = {}
    for key, (vendored_name, original_name) in GRAPH_FILES.items():
        for base in candidates:
            for name in (vendored_name, original_name):
                p = base / name
                if p.exists():
                    resolved[key] = p
                    break
            if key in resolved:
                break
        if key not in resolved:
            raise FileNotFoundError(
                f"could not find the '{key}' reference graph in any of: "
                + ", ".join(str(c) for c in candidates)
            )
    return resolved


# -----------------------------------------------------------------------------
# low level helpers
# -----------------------------------------------------------------------------
def load_rgb(path: Path) -> np.ndarray:
    return np.array(Image.open(path).convert("RGB")).astype(int)


def runs(vals: np.ndarray):
    out, start = [], None
    for i, v in enumerate(vals):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i - 1))
            start = None
    if start is not None:
        out.append((start, len(vals) - 1))
    return out


def longest_run(dark: np.ndarray, axis: int):
    """Longest contiguous dark run along `axis` (0=rows->vertical, 1=rows->horizontal)."""
    best = (0, None, None)
    if axis == 0:
        for x in range(dark.shape[1]):
            for (s, e) in runs(dark[:, x]):
                if e - s + 1 > best[0]:
                    best = (e - s + 1, x, (s, e))
    else:
        for y in range(dark.shape[0]):
            for (s, e) in runs(dark[y, :]):
                if e - s + 1 > best[0]:
                    best = (e - s + 1, y, (s, e))
    return best


def fit_line(pixels: list[float], values: list[float]):
    """Least-squares fit of value = a * pixel + b."""
    p = np.asarray(pixels, dtype=float)
    v = np.asarray(values, dtype=float)
    a, b = np.polyfit(p, v, 1)
    return float(a), float(b)


# -----------------------------------------------------------------------------
# axis recovery
# -----------------------------------------------------------------------------
def axes_of(img: np.ndarray):
    """Return (spine_x, spine_top_y, spine_bottom_y)."""
    dark = img.max(axis=2) < 140
    vlen, vx, (vtop, vbot) = longest_run(dark, 0)
    hlen, hy, (hleft, hright) = longest_run(dark, 1)
    # the vertical spine gives top/bottom of the axes box
    return vx, vtop, vbot


def y_tick_rows(img: np.ndarray, spine_x: int) -> list[float]:
    dark = img.max(axis=2) < 140
    rows = []
    for y in range(img.shape[0]):
        if dark[y, max(0, spine_x - 14):spine_x - 1].any():
            rows.append(y)
    groups = []
    for y in rows:
        if groups and y - groups[-1][-1] <= 3:
            groups[-1].append(y)
        else:
            groups.append([y])
    return [sum(g) / len(g) for g in groups]


def x_tick_cols(img: np.ndarray, spine_bottom_y: int, spine_x: int) -> list[float]:
    """
    Tick MARKS (not label glyphs) sit in the ~5 px band just below the x spine.
    Label text starts ~7 px lower, so a tight band isolates the marks.
    Columns left of the y spine (the axis title) are discarded.
    """
    dark = img.max(axis=2) < 140
    cols = []
    for x in range(spine_x + 1, img.shape[1]):
        if dark[spine_bottom_y + 1:min(img.shape[0], spine_bottom_y + 6), x].any():
            cols.append(x)
    groups = []
    for x in cols:
        if groups and x - groups[-1][-1] <= 3:
            groups[-1].append(x)
        else:
            groups.append([x])
    return [sum(g) / len(g) for g in groups]


def build_transforms(img: np.ndarray, y_tick_values: list[int], x_span_hint=None):
    """Return (y_of, x_of) callables mapping pixel -> data."""
    sx, top, bot = axes_of(img)
    yt = y_tick_rows(img, sx)
    if len(yt) != len(y_tick_values):
        raise RuntimeError(f"expected {len(y_tick_values)} y-ticks, found {len(yt)}: {yt}")
    # tick rows are top -> bottom, values also top -> bottom
    ya, yb = fit_line(yt, y_tick_values)

    xt = x_tick_cols(img, bot, sx)
    if len(xt) != len(X_TICKS):
        raise RuntimeError(f"expected {len(X_TICKS)} x-ticks, found {len(xt)}: {xt}")
    xa, xb = fit_line(xt, X_TICKS)

    def y_of(px):
        return ya * px + yb

    def x_of(year):
        return (year - xb) / xa

    return y_of, x_of, dict(spine_x=sx, top=top, bottom=bot, yticks=yt, xticks=xt)


# -----------------------------------------------------------------------------
# curve tracing
# -----------------------------------------------------------------------------
def colour_mask(img: np.ndarray, colour, tol: int = 12) -> np.ndarray:
    d = np.abs(img - np.array(colour)).sum(axis=2)
    return d <= tol


def trace_chain(mask: np.ndarray, x_start: int, x_end: int):
    """
    Trace a coloured curve between x_start..x_end with a dynamic program.

    The path is scored by
        cost = JUMP_COST * total vertical movement
             + GAP_PENALTY * number of columns in [x_start, x_end] the path
               does not actually occupy

    The second term is what makes this robust: the matplotlib legend swatch in
    the upper-left occupies only ~35 columns, so any path that teleports from
    the swatch to the real curve leaves hundreds of columns uncovered and is
    rejected. The genuine curve wins because it occupies (nearly) every
    column. Dashed series still trace correctly because their gaps are few
    and short.

    Returns (chain, diagnostics). ``chain`` maps column -> row.
    """
    present = [x for x in range(x_start, x_end + 1) if mask[:, x].any()]
    if not present:
        return {}, {"present": 0}

    cands = {x: [int(v) for v in np.nonzero(mask[:, x])[0]] for x in present}
    n = len(present)

    # dp[i][y] = (best cost from (present[i], y) to the last present column,
    #              next row on that path)
    dp: list[dict[int, tuple[float, int | None]]] = [dict() for _ in range(n)]
    for y in cands[present[-1]]:
        dp[n - 1][y] = (0.0, None)

    for i in range(n - 2, -1, -1):
        x, xn = present[i], present[i + 1]
        dx = xn - x
        nxt = dp[i + 1]
        for y in cands[x]:
            best = None
            for yn, (c, _) in nxt.items():
                d = abs(y - yn)
                if d > MAX_JUMP * max(1, dx):
                    continue
                cc = c + d * JUMP_COST + GAP_PENALTY * (dx - 1)
                if best is None or cc < best[0]:
                    best = (cc, yn)
            if best is not None:
                dp[i][y] = best

    # choose the start: cheapest total = cost-to-end + penalty for the
    # columns before the start that the path leaves uncovered
    best_total, best_i, best_y = None, None, None
    for i, x in enumerate(present):
        head = GAP_PENALTY * (x - x_start)
        for y, (c, _) in dp[i].items():
            total = c + head
            if best_total is None or total < best_total:
                best_total, best_i, best_y = total, i, y
    if best_i is None:
        return {}, {"present": n}

    # backtrack
    chain: dict[int, int] = {}
    i, y = best_i, best_y
    while i < n:
        chain[present[i]] = int(y)
        nxt = dp[i][y][1]
        if nxt is None:
            break
        y = nxt
        i += 1

    diag = {
        "present": n,
        "start_x": present[best_i],
        "end_x": present[-1],
        "cost": best_total,
        "covered": len(chain),
        "span": x_end - x_start + 1,
    }
    return chain, diag


def sample_curve(mask: np.ndarray, chain: dict[int, int], x_of, y_of, years):
    """
    Sample the traced curve at integer years.

    Where the dash pattern stops short of the data end (the urban series is
    dashed and its last dash can end a few pixels before year 15) the tail is
    linearly extrapolated from the final segment, then clamped to the physical
    floor of the axis.
    """
    xs = sorted(chain)
    if not xs:
        raise RuntimeError("empty chain")
    rows = [float(chain[x]) for x in xs]
    out = {}
    for year in years:
        xt = x_of(year)
        if xt <= xs[0]:
            if len(xs) >= 2:
                slope = (rows[1] - rows[0]) / max(xs[1] - xs[0], 1e-9)
            else:
                slope = 0.0
            row = rows[0] + slope * (xt - xs[0])
        elif xt >= xs[-1]:
            if len(xs) >= 2:
                slope = (rows[-1] - rows[-2]) / max(xs[-1] - xs[-2], 1e-9)
            else:
                slope = 0.0
            row = rows[-1] + slope * (xt - xs[-1])
        else:
            j = int(np.searchsorted(xs, xt)) - 1
            j = max(0, min(j, len(xs) - 2))
            x0, x1 = xs[j], xs[j + 1]
            f = 0.0 if x1 == x0 else (xt - x0) / (x1 - x0)
            row = rows[j] + f * (rows[j + 1] - rows[j])

        # refine with the actual pixels near the interpolated row. The window
        # is anchored on the *clamped* column so the series tail is refined
        # even when the target year sits just past the last drawn dash.
        x_ref = min(max(xt, xs[0]), xs[-1])
        near = [x for x in xs if abs(x - x_ref) <= 3]
        vals = []
        for x in near:
            ys = np.nonzero(mask[:, x])[0]
            close = ys[np.abs(ys - row) <= 3]
            if close.size:
                vals.append(float(np.median(close)))
        if vals:
            row = float(np.median(vals))
        out[year] = y_of(row)
    return out


# -----------------------------------------------------------------------------
# bar graph cross-check
# -----------------------------------------------------------------------------
# Tick values read off the rendered bar-graph axes:
#   left  panel "Year 15 Canopy Cover"     0,20,40,60,80,100  (top -> bottom)
#   right panel "Year 15 Illustrative CO2e" 0,50,...,400        (top -> bottom)
BARS_PANELS = {
    "canopy": {"spine_x": 82, "right_x": 531, "ticks": [100, 80, 60, 40, 20, 0]},
    "co2e": {"spine_x": 613, "right_x": 1062, "ticks": [400, 350, 300, 250, 200, 150, 100, 50, 0]},
}


def bar_cross_check(path: Path):
    """Measure the year-15 bar heights in the two-panel bar graph."""
    img = load_rgb(path)
    dark = img.max(axis=2) < 140
    res = {}
    for panel, cfg in BARS_PANELS.items():
        x0, x1 = cfg["spine_x"], cfg["right_x"]
        rows = []
        for y in range(img.shape[0]):
            if dark[y, max(0, x0 - 6):x0 - 1].any():
                rows.append(y)
        groups = []
        for y in rows:
            if groups and y - groups[-1][-1] <= 3:
                groups[-1].append(y)
            else:
                groups.append([y])
        yt = [sum(g) / len(g) for g in groups]
        values = cfg["ticks"]
        if len(yt) != len(values):
            raise RuntimeError(f"bar panel {panel}: expected {len(values)} ticks, got {len(yt)}: {yt}")
        ya, yb = fit_line(yt, values)

        colours = {"mangrove": (45, 138, 78), "urban": (74, 144, 217)}
        vals = {}
        for name, col in colours.items():
            m = colour_mask(img, col)
            m[:, :x0] = False
            m[:, x1:] = False
            ys, xs = np.nonzero(m)
            if ys.size == 0:
                continue
            top = int(ys.min())
            bot = int(ys.max())
            vals[name] = {
                "top_px": top,
                "bottom_px": bot,
                "value": ya * top + yb,
                "x": [int(xs.min()), int(xs.max())],
            }
        res[panel] = {"yticks": yt, "ticks": values, "bars": vals}
    return res


# -----------------------------------------------------------------------------
# main
# -----------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="write growth_reference.csv")
    ap.add_argument("--pics", default=None,
                    help="directory holding the source graphs (default: the vendored copy "
                         "in data/reference_graphs/)")
    args = ap.parse_args()

    graphs = resolve_graphs(Path(args.pics) if args.pics else None)
    for key, p in graphs.items():
        print(f"source graph '{key}': {p}")

    years = list(range(0, 16))

    # ---- canopy graph ------------------------------------------------------
    canopy_img = load_rgb(graphs["canopy"])
    cy_of, cx_of, cmeta = build_transforms(canopy_img, CANOPY_Y_TICKS)
    print("canopy axes:", cmeta)

    canopy = {}
    for name, colour in SERIES.items():
        m = colour_mask(canopy_img, colour)
        chain, diag = trace_chain(m, int(round(cx_of(0))), int(round(cx_of(15))))
        print(f"  canopy/{name}: {diag}")
        canopy[name] = sample_curve(m, chain, cx_of, cy_of, years)

    # ---- carbon graph ------------------------------------------------------
    carbon_img = load_rgb(graphs["carbon"])
    ry_of, rx_of, rmeta = build_transforms(carbon_img, CARBON_Y_TICKS)
    print("carbon axes:", rmeta)

    carbon = {}
    for name, colour in SERIES.items():
        m = colour_mask(carbon_img, colour)
        chain, diag = trace_chain(m, int(round(rx_of(0))), int(round(rx_of(15))))
        print(f"  carbon/{name}: {diag}")
        carbon[name] = sample_curve(m, chain, rx_of, ry_of, years)

    # ---- report ------------------------------------------------------------
    print()
    hdr = f"{'yr':>3} | {'mang canopy %':>12} {'urb canopy %':>12} | {'mang tC/ha':>10} {'urb tC/ha':>10}"
    print(hdr)
    print("-" * len(hdr))
    for y in years:
        print(
            f"{y:>3} | {canopy['mangrove'][y]:>12.2f} {canopy['urban'][y]:>12.2f} | "
            f"{carbon['mangrove'][y]:>10.2f} {carbon['urban'][y]:>10.2f}"
        )

    # ---- bar cross-check ---------------------------------------------------
    print("\nbar graph cross-check:")
    bars = bar_cross_check(graphs["bars"])
    worst = 0.0
    for panel, info in bars.items():
        print(f"  {panel}: yticks={info['yticks']}")
        for name, b in info["bars"].items():
            if panel == "canopy":
                digitised = canopy[name][15]
            else:
                digitised = carbon[name][15] * (44.0 / 12.0)
            err = abs(b["value"] - digitised)
            worst = max(worst, err)
            print(
                f"    {name:9s} top={b['top_px']:>3} bottom={b['bottom_px']:>3} "
                f"x={b['x']}  bar={b['value']:>8.2f}  digitised={digitised:>8.2f}  "
                f"err={err:>5.2f} ({100 * err / max(digitised, 1e-9):.2f}%)"
            )
    print(f"  worst absolute error: {worst:.2f}")

    # ---- write CSV ---------------------------------------------------------
    out_rows = []
    for name in ("mangrove", "urban"):
        for y in years:
            tco2e = carbon[name][y] * (44.0 / 12.0)
            out_rows.append(
                {
                    "scenario": name,
                    "year": y,
                    "canopy_pct": round(canopy[name][y], 2),
                    "carbon_tco2e": round(tco2e, 2),
                    "carbon_tc": round(carbon[name][y], 2),
                    "source": (
                        "digitised from SAP reference graphs "
                        "'image (2).png' (canopy %) and 'image (1).png' (cumulative tC/ha)"
                    ),
                }
            )

    print("\nCSV rows:")
    for r in out_rows:
        print(f"  {r['scenario']:8s} y{r['year']:>2}  canopy={r['canopy_pct']:>6.2f}%  "
              f"carbon={r['carbon_tco2e']:>8.2f} tCO2e/ha  ({r['carbon_tc']:>6.2f} tC/ha)")

    if args.write:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        path = DATA_DIR / "growth_reference.csv"
        with path.open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(
                fh,
                fieldnames=["scenario", "year", "canopy_pct", "carbon_tco2e", "carbon_tc", "source"],
            )
            w.writeheader()
            w.writerows(out_rows)
        print(f"\n[written] {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
