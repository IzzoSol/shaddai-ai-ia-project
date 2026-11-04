"""
SAP Forest EduTwin — local model layer
---------------------------------------
Priority order (all local, all $0, all 8GB-friendly):

 1. Ollama  (http://localhost:11434)  -> qwen2.5:1.5b / qwen2.5:3b / gemma2:2b / phi3:mini
 2. transformers + bitsandbytes 4-bit  -> Qwen/Qwen2.5-1.5B-Instruct, google/gemma-2-2b-it
 3. Deterministic template fallback      -> always works, no model required

Nothing ever leaves the machine. No API keys, no telemetry.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import List, Dict, Optional

OLLAMA_URL = os.environ.get("SAP_OLLAMA_URL", "http://localhost:11434")
DEFAULT_OLLAMA_MODEL = os.environ.get("SAP_OLLAMA_MODEL", "qwen2.5:1.5b")

RECOMMENDED_OLLAMA = ["qwen2.5:1.5b", "qwen2.5:3b", "gemma2:2b", "phi3:mini"]
RECOMMENDED_HF = [
    "Qwen/Qwen2.5-1.5B-Instruct",
    "Qwen/Qwen2.5-3B-Instruct",
    "google/gemma-2-2b-it",
    "microsoft/Phi-3-mini-4k-instruct",
]


@dataclass
class LocalModel:
    backend: str          # 'ollama' | 'transformers' | 'template'
    name: str
    available: bool
    detail: str = ""


def _requests():
    try:
        import requests  # noqa
        return requests
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Ollama
# ---------------------------------------------------------------------------
def ollama_models() -> List[str]:
    req = _requests()
    if not req:
        return []
    try:
        r = req.get(f"{OLLAMA_URL}/api/tags", timeout=2.5)
        if r.status_code != 200:
            return []
        data = r.json()
        return [m.get("name", "") for m in data.get("models", [])]
    except Exception:
        return []


def ollama_available() -> bool:
    return bool(ollama_models())


def ollama_generate(prompt: str, system: str = "", model: str = DEFAULT_OLLAMA_MODEL,
                    temperature: float = 0.4, num_predict: int = 420,
                    context: Optional[List[Dict]] = None) -> Optional[str]:
    """
    Generate with Ollama. Returns None if the backend is unavailable so callers
    can fall back to the template explainer.
    """
    req = _requests()
    if not req:
        return None
    try:
        if context:
            messages = [{"role": "system", "content": system}] + context
            payload = {
                "model": model,
                "messages": messages,
                "stream": False,
                "options": {"temperature": temperature, "num_predict": num_predict},
            }
            r = req.post(f"{OLLAMA_URL}/api/chat", json=payload, timeout=90)
        else:
            payload = {
                "model": model,
                "prompt": f"{system}\n\n{prompt}" if system else prompt,
                "stream": False,
                "options": {"temperature": temperature, "num_predict": num_predict},
            }
            r = req.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=90)
        if r.status_code != 200:
            return None
        data = r.json()
        if context:
            return (data.get("message") or {}).get("content")
        return data.get("response")
    except Exception:
        return None


# ---------------------------------------------------------------------------
# transformers 4-bit fallback
# ---------------------------------------------------------------------------
_HF_PIPE = None
_HF_ID = None


def hf_available() -> bool:
    try:
        import transformers  # noqa
        import torch  # noqa
        return True
    except Exception:
        return False


def hf_generate(prompt: str, system: str = "", model_id: str = "Qwen/Qwen2.5-1.5B-Instruct",
                max_new_tokens: int = 380) -> Optional[str]:
    """4-bit quantized transformers generation. Loads lazily, caches the pipeline."""
    global _HF_PIPE, _HF_ID
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer, pipeline

        if _HF_PIPE is None or _HF_ID != model_id:
            tok = AutoTokenizer.from_pretrained(model_id)
            model = None
            try:
                model = AutoModelForCausalLM.from_pretrained(
                    model_id,
                    load_in_4bit=True,          # bitsandbytes 4-bit
                    bnb_4bit_compute_dtype=torch.float16,
                    bnb_4bit_quant_type="nf4",
                    device_map="auto",
                )
            except Exception as e:
                print(f"[SAP] 4-bit / device_map load failed ({e}); trying plain CPU load")
                try:
                    model = AutoModelForCausalLM.from_pretrained(model_id)
                except Exception as e2:
                    print(f"[SAP] plain load failed too: {e2}")
                    return None
            _HF_PIPE = pipeline("text-generation", model=model, tokenizer=tok,
                                max_new_tokens=max_new_tokens)
            _HF_ID = model_id

        full = f"{system}\n\n{prompt}" if system else prompt
        out = _HF_PIPE(f"<|im_start|>user\n{full}<|im_end|>\n<|im_start|>assistant\n",
                       max_new_tokens=max_new_tokens, do_sample=True, temperature=0.4)
        return out[0]["generated_text"]
    except Exception as e:
        print(f"[SAP] transformers backend failed: {e}")
        return None


# ---------------------------------------------------------------------------
# Unified entry point
# ---------------------------------------------------------------------------
def resolve_backend(preferred: str = "auto") -> LocalModel:
    """
    Figure out which local backend is actually usable right now.

    Order: Ollama -> (optional) transformers 4-bit -> deterministic template.

    The transformers backend is OPT-IN because loading a 1.5B checkpoint pulls
    ~3 GB from Hugging Face. Set SAP_BACKEND=transformers to enable it.
    """
    preferred = preferred or os.environ.get("SAP_BACKEND", "auto")

    if preferred in ("auto", "ollama"):
        models = ollama_models()
        if models:
            pick = DEFAULT_OLLAMA_MODEL if DEFAULT_OLLAMA_MODEL in models else models[0]
            return LocalModel("ollama", pick, True, f"{len(models)} model(s) installed")
        if preferred == "ollama":
            return LocalModel("template", "template", True, "Ollama not reachable")

    if preferred in ("auto", "transformers"):
        if preferred == "transformers" or os.environ.get("SAP_BACKEND") == "transformers":
            if hf_available():
                return LocalModel("transformers", RECOMMENDED_HF[0], True, "4-bit (bitsandbytes)")

    return LocalModel("template", "template", True, "No local model detected — using deterministic explainer")


def generate(prompt: str, system: str = "", backend: LocalModel = None,
             context: Optional[List[Dict]] = None) -> str:
    """Generate text with whatever backend is available. Never raises."""
    backend = backend or resolve_backend()
    if backend.backend == "ollama":
        out = ollama_generate(prompt, system, backend.name, context=context)
        if out:
            return out.strip()
    elif backend.backend == "transformers":
        out = hf_generate(prompt, system, backend.name)
        if out:
            return out.strip()
    return None


def backend_status_markdown() -> str:
    b = resolve_backend()
    if b.backend == "ollama":
        models = ", ".join(ollama_models())
        return (f"**Local model:** `{b.name}` via Ollama — available ({models}). "
                "All inference is on-device; nothing is sent to a cloud service.")
    if b.backend == "transformers":
        return (f"**Local model:** `{b.name}` via transformers 4-bit (bitsandbytes NF4). "
                "On-device; nothing leaves this machine.")
    return ("**Local model:** none detected — using the deterministic template explainer.\n\n"
            "To enable narration: `ollama serve` then `ollama pull qwen2.5:1.5b` "
            "(≈1 GB RAM, runs comfortably on 8 GB hardware).")
