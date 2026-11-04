---
license: odc-by
language:
- en
pretty_name: CADGenBench (Inputs)
task_categories:
- image-to-3d
- text-to-3d
tags:
- cad
- 3d
- step
- mechanical-engineering
- benchmark
- cad-generation
- cad-editing
size_categories:
- n<1K
annotations_creators:
- expert-generated
language_creators:
- expert-generated
multilinguality:
- monolingual
source_datasets:
- original
viewer: false
---

# CADGenBench (Inputs)

Public inputs for the **CADGenBench** benchmark, which measures how well AI
systems produce correct 3D mechanical parts as STEP files. This repository
holds the task inputs only; the ground truth is withheld in a separate private
repository so that the leaderboard's evaluation is the single source of truth.

- **Leaderboard Space**: [`HuggingAI4Engineering/CADGenBench`](https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench)
- **Browse the tasks**: the [Tasks tab](https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench) on the Space (thumbnails, search, generation/editing filter, per-task detail)
- **Benchmark code**: [`github.com/huggingface/cadgenbench`](https://github.com/huggingface/cadgenbench)
- **Submissions + results**: [`HuggingAI4Engineering/cadgenbench-submissions`](https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-submissions)
- **Ground truth**: [`HuggingAI4Engineering/cadgenbench-data-gt`](https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-data-gt) (private)

## Dataset Summary

CADGenBench contains **81 fixtures** of mechanical parts split across two
tasks:

- **Generation (49)**: reproduce the part as an accurate 3D solid from an
  engineering drawing.
- **Editing (32)**: apply a described change to an existing STEP solid.

Each submission is one `output.step` per fixture. Outputs are scored against
the private ground truth by the CAD Score pipeline: a hard validity gate
followed by a weighted mean of three orthogonal metrics (shape similarity,
interface match, topology match). See the
[metric definitions](https://github.com/huggingface/cadgenbench/blob/main/docs/metrics.md).

## Supported Tasks and Leaderboards

The benchmark is tool-agnostic: a submission is one STEP file per fixture,
produced by any system (one LLM, several, a script, or by hand). Submit and
view results on the
[leaderboard Space](https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench);
the full submission contract (zip layout, `meta.json`, validity gate) is in
[`docs/benchmark/submission.md`](https://github.com/huggingface/cadgenbench/blob/main/docs/benchmark/submission.md).

## Languages

Task prompts and descriptions are in English.

## Dataset Structure

### Data Instances

One directory per fixture, named by its numeric id. There are two shapes:

```
# Generation fixture
<id>/
├── description.yaml      # prompt + metadata
└── input.png            # the engineering drawing (input2.png, ... when multi-image)

# Editing fixture
<id>/
├── description.yaml      # prompt + metadata
├── edit_description.txt  # the requested change, as an instruction
├── input.step           # the starting solid to edit
├── input.mesh.npz       # trusted watertight mesh sidecar for input.step
└── renders/             # iso / front / top / right PNGs of the starting solid
```

### Data Fields

`description.yaml` carries:

| Field | Type | Description |
|---|---|---|
| `description` | string | The task prompt. |
| `task_type` | `"generation"` \| `"editing"` | The task family. |
| `input_files` | list of strings | The input files the task declares (e.g. `input.png`, `input2.png`, or `input.step`). |
| `input_type` | `"text+image"` \| `"text+step"` | Modality of the inputs. |

### Data Splits

No train/test split — all 81 fixtures form a single evaluation set
(49 generation, 32 editing).

## Dataset Creation

### Source Data

The underlying CAD geometry is sourced from [Mecado](https://www.mecado.com).
Fixtures are real mechanical parts with mating interfaces (locating jigs, bolt
patterns, slots). For each part, an engineering drawing (generation) or a
starting solid plus an edit instruction (editing) forms the public input; the
solved solid and its interface sub-volumes are held privately as ground truth.

### Curation Rationale

The inputs are released publicly so contestants see exactly what they are
solving, while the ground truth stays private so the leaderboard's server-side
evaluation is the only path to a score.

## Considerations for Using the Data

This is a benchmark **input** set, not a training corpus. To participate,
generate one `output.step` per fixture and submit through the leaderboard
Space.

## Additional Information

### Dataset Curators

The CADGenBench team ([HuggingAI4Engineering](https://huggingface.co/HuggingAI4Engineering)).

### Licensing Information

Released under the [Open Data Commons Attribution License (ODC-BY)](https://opendatacommons.org/licenses/by/1-0/).

### Acknowledgements

CAD geometry sourced from [Mecado](https://www.mecado.com). Thanks to the
Mecado team.
