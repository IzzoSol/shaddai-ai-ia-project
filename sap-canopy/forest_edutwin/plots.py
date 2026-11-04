"""
SAP Forest EduTwin — charts
Plotly figures styled to match the TREEGENS Dashboard v2 / SAP Canopy tokens.
Dark surface, green accent (#4caf50), gold highlight (#ffd54f).
"""

from __future__ import annotations

from typing import Dict, List

import plotly.graph_objects as go

ACCENT = "#4caf50"
GOLD = "#ffd54f"
MANGROVE = "#2e7d32"
URBAN = "#66bb6a"
BG = "#121a22"
PAPER = "#0b0f14"
TEXT = "#e6edf3"
MUTED = "#9fb0c3"
BORDER = "#223141"


def _layout(fig: go.Figure, title: str, y_title: str) -> go.Figure:
    fig.update_layout(
        title=dict(text=title, font=dict(size=14, color=TEXT)),
        paper_bgcolor=PAPER,
        plot_bgcolor=BG,
        font=dict(color=TEXT, family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif", size=12),
        margin=dict(l=56, r=18, t=44, b=42),
        xaxis=dict(title="Year", gridcolor=BORDER, zerolinecolor=BORDER, linecolor=BORDER),
        yaxis=dict(title=y_title, gridcolor=BORDER, zerolinecolor=BORDER, linecolor=BORDER),
        hoverlabel=dict(bgcolor=BG, bordercolor=BORDER, font_color=TEXT),
        legend=dict(bgcolor="rgba(0,0,0,0)", orientation="h", yanchor="bottom", y=1.02, x=0),
        showlegend=False,
        height=340,
    )
    return fig


def canopy_chart(rows: List[Dict], scenario_label: str) -> go.Figure:
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=[r["year"] for r in rows],
        y=[r["canopy_pct"] for r in rows],
        mode="lines+markers",
        name="Canopy cover",
        line=dict(color=ACCENT, width=3, shape="spline", smoothing=0.6),
        marker=dict(size=6, color=GOLD, line=dict(width=1, color=ACCENT)),
        fill="tozeroy",
        fillcolor="rgba(76,175,80,.16)",
        hovertemplate="Year %{x}<br>Canopy %{y:.1f}%<extra></extra>",
    ))
    fig.add_hline(y=30, line=dict(color=MUTED, width=1, dash="dot"),
                  annotation_text="30% reference", annotation_position="right")
    return _layout(fig, f"Canopy cover — {scenario_label}", "Canopy cover (%)")


def carbon_chart(rows: List[Dict], scenario_label: str) -> go.Figure:
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=[r["year"] for r in rows],
        y=[r["carbon_tco2e"] for r in rows],
        mode="lines+markers",
        name="Cumulative carbon",
        line=dict(color=GOLD, width=3, shape="spline", smoothing=0.6),
        marker=dict(size=6, color=GOLD),
        fill="tozeroy",
        fillcolor="rgba(255,213,79,.14)",
        hovertemplate="Year %{x}<br>%{y:,.1f} tCO2e<extra></extra>",
    ))
    return _layout(fig, f"Cumulative carbon storage — {scenario_label}", "tCO2e (cumulative)")


def compare_chart(cmp: Dict) -> go.Figure:
    fig = go.Figure()
    for key, color, label in (("mangrove", MANGROVE, "Mangrove"), ("urban", URBAN, "Urban street")):
        rows = cmp[key]["rows"]
        fig.add_trace(go.Scatter(
            x=[r["year"] for r in rows], y=[r["canopy_pct"] for r in rows],
            mode="lines", name=f"{label} canopy",
            line=dict(color=color, width=3, shape="spline", smoothing=0.6),
            hovertemplate=f"{label}<br>Year %{{x}}<br>Canopy %{{y:.1f}}%<extra></extra>",
        ))
        fig.add_trace(go.Scatter(
            x=[r["year"] for r in rows], y=[r["carbon_tco2e"] for r in rows],
            mode="lines", name=f"{label} carbon",
            line=dict(color=color, width=2, dash="dot"),
            yaxis="y2",
            hovertemplate=f"{label}<br>Year %{{x}}<br>%{{y:,.1f}} tCO2e<extra></extra>",
        ))
    fig.update_layout(yaxis2=dict(title="tCO2e", overlaying="y", side="right", gridcolor="rgba(0,0,0,0)",
                                   linecolor=BORDER))
    fig.update_layout(showlegend=True, legend=dict(bgcolor="rgba(0,0,0,0)", orientation="h",
                                                   yanchor="bottom", y=1.06, x=0, font=dict(size=11)))
    return _layout(fig, "Mangrove vs urban street canopy", "Canopy cover (%)")


def stems_chart(rows: List[Dict], scenario_label: str) -> go.Figure:
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=[r["year"] for r in rows],
        y=[r["living_stems"] for r in rows],
        mode="lines+markers",
        line=dict(color="#90caf9", width=2),
        marker=dict(size=5),
        hovertemplate="Year %{x}<br>%{y:,.0f} living stems<extra></extra>",
    ))
    fig.add_trace(go.Scatter(
        x=[r["year"] for r in rows],
        y=[r["mean_height_m"] for r in rows],
        mode="lines",
        line=dict(color=ACCENT, width=2, dash="dot"),
        yaxis="y2",
        hovertemplate="Year %{x}<br>%{y:.1f} m mean height<extra></extra>",
    ))
    fig.update_layout(yaxis2=dict(title="m", overlaying="y", side="right", gridcolor="rgba(0,0,0,0)",
                                   linecolor=BORDER))
    fig.update_layout(showlegend=True)
    return _layout(fig, f"Living stems & mean height — {scenario_label}", "Living stems")


def summary_cards(cmp: Dict, area_ha: float, years: int) -> str:
    m = cmp["mangrove"]["summary"]
    u = cmp["urban"]["summary"]

    def row(label, key, fmt="{:,.1f}"):
        a = fmt.format(m[key])
        b = fmt.format(u[key])
        return f"| {label} | {a} | {b} |"

    return f"""
| Metric | Mangrove restoration | Urban street canopy |
|---|---|---|
{row('Canopy cover (year %d)' % years, 'canopy_end_pct', '{:.1f}%')}
{row('Cumulative carbon (tCO2e)', 'carbon_tco2e', '{:,.1f}')}
{row('Carbon per hectare', 'carbon_tco2e_per_ha', '{:.2f}')}
{row('Living stems', 'living_stems', '{:,.0f}')}
{row('Mean height (m)', 'mean_height_m', '{:.1f}')}
{row('Indicative cost (USD)', 'cost_estimate', '${:,.0f}')}
{row('Cost per tCO2e', 'cost_per_tco2e', '${:,.0f}')}
""".strip()
