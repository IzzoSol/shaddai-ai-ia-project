"""
SAP Urban Forest Growth Explainer
Bridges Treegens ReFi regeneration scenarios with NVIDIA physical AI / smart-city narrative.

Educational mini-sim: 15-year canopy growth, carbon impact estimates, natural-language walkthrough.
Runs on modest hardware. No external API required.

Author: TURTLE design / Shaddai Asimov Project
"""

import gradio as gr
import math
import matplotlib.pyplot as plt
from io import BytesIO
import base64

SPECIES = {
    "Urban Oak - Quercus alba": {"max_h": 25, "k": 0.08, "canopy_factor": 0.6, "carbon_factor": 0.45},
    "Sugar Maple - Acer saccharum": {"max_h": 22, "k": 0.09, "canopy_factor": 0.55, "carbon_factor": 0.42},
    "Mangrove - Rhizophora mangle": {"max_h": 15, "k": 0.12, "canopy_factor": 0.7, "carbon_factor": 0.55},
    "Mangrove - Avicennia germinans": {"max_h": 12, "k": 0.13, "canopy_factor": 0.65, "carbon_factor": 0.50},
    "Street Tree - Platanus x acerifolia": {"max_h": 20, "k": 0.10, "canopy_factor": 0.5, "carbon_factor": 0.40}
}

def growth_model(age, max_h, k):
    return max_h * (1 - math.exp(-k * age))

def canopy_area(height, factor):
    return math.pi * (height * factor / 2) ** 2

def carbon_tonnes(biomass_kg):
    return biomass_kg * 0.5 * 0.47 / 1000  # rough conversion

def simulate(species_name, start_age, years, plant_count):
    params = SPECIES[species_name]
    ages = list(range(start_age, start_age + years + 1))
    heights = []
    canopies = []
    carbons = []
    for a in ages:
        h = growth_model(a, params["max_h"], params["k"])
        c = canopy_area(h, params["canopy_factor"])
        # simplistic biomass proxy
        biomass = h * c * params["carbon_factor"]
        carbon = carbon_tonnes(biomass)
        heights.append(h)
        canopies.append(c)
        carbons.append(carbon)
    return ages, heights, canopies, carbons

def plot_growth(ages, heights, canopies):
    fig, ax1 = plt.subplots(figsize=(8,4))
    ax1.plot(ages, heights, label="Height (m)", marker="o")
    ax1.set_xlabel("Age (years)")
    ax1.set_ylabel("Height (m)", color="tab:green")
    ax2 = ax1.twinx()
    ax2.plot(ages, canopies, label="Canopy area (m²)", color="tab:orange", marker="s")
    ax2.set_ylabel("Canopy area (m²)", color="tab:orange")
    plt.title("15-Year Canopy Growth Projection")
    fig.tight_layout()
    buf = BytesIO()
    plt.savefig(buf, format="png")
    plt.close(fig)
    buf.seek(0)
    return "data:image/png;base64," + base64.b64encode(buf.read()).decode()

def explain(species_name, start_age, years, plant_count):
    ages, heights, canopies, carbons = simulate(species_name, start_age, years, plant_count)
    h_start, h_end = heights[0], heights[-1]
    c_start, c_end = canopies[0], canopies[-1]
    co2_start = sum(carbons[0] for _ in range(plant_count))
    co2_end = sum(carbons[-1] for _ in range(plant_count))
    delta_co2 = co2_end - co2_start

    # Natural language walkthrough
    narrative = f"""
**Urban Forest Growth Walkthrough — {species_name}**

This mini-sim mirrors the NVIDIA + Linker Vision / MVRDV approach used for smart-city digital twins:
the team can evaluate 15-year urban forest outcomes in minutes instead of weeks.

* Starting age: {start_age} years, {plant_count} trees
* Projection horizon: {years} years
* Height: {h_start:.1f} m → {h_end:.1f} m  (+{h_end-h_start:.1f} m)
* Canopy area per tree: {c_start:.1f} m² → {c_end:.1f} m²
* Estimated carbon sequestration per tree: {carbons[0]:.2f} tCO₂e → {carbons[-1]:.2f} tCO₂e
* Portfolio impact: ~{delta_co2:.1f} tCO₂e additional storage over {years} years

**What this means for Treegens ReFi:**
- Regeneration claims can be visualized as a living digital twin, not just a spreadsheet.
- The 15-year horizon aligns with NVIDIA Omniverse simulations that model shade, heat island reduction, and air quality.
- With physical AI vision agents (Metropolis), these projected canopies can be checked against real camera feeds for growth verification.

**Physical AI bridge:**
NVIDIA's urban-forest narrative emphasizes fast iteration for planning. This explainer provides the citizen-facing narrative layer — explaining *why* growth matters, how carbon accrues, and how smart-city infrastructure can validate outcomes on the ground.

Use this as an educational on-ramp to the full SAP Three.js canopy digital twin.
"""
    return narrative.strip()

def run_demo(species_name, start_age, years, plant_count):
    ages, heights, canopies, carbons = simulate(species_name, start_age, years, plant_count)
    img = plot_growth(ages, heights, canopies)
    text = explain(species_name, start_age, years, plant_count)
    return img, text

demo = gr.Interface(
    fn=run_demo,
    inputs=[
        gr.Dropdown(choices=list(SPECIES.keys()), value="Urban Oak - Quercus alba", label="Species"),
        gr.Slider(1, 30, value=5, step=1, label="Starting Age (years)"),
        gr.Slider(5, 25, value=15, step=1, label="Projection Years"),
        gr.Slider(1, 500, value=50, step=1, label="Number of Trees")
    ],
    outputs=[
        gr.Image(type="pil", label="Growth Projection"),
        gr.Markdown(label="Natural-Language Walkthrough")
    ],
    title="SAP Urban Forest Growth Explainer",
    description="Educational mini-sim bridging Treegens ReFi regeneration with NVIDIA physical AI smart-city narrative. Inspired by Linker Vision + MVRDV 15-year urban forest canopy simulations via Omniverse.",
    theme=gr.themes.Soft()
)

if __name__ == "__main__":
    demo.launch(server_name="127.0.0.1", server_port=7860, share=False)
