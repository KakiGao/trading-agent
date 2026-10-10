"""Dashboard provider selection, independent credentials and worker mapping."""
import os
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, field_validator

FLUXPORT_BASE = "https://api.uselg.top/v1"
GRSAI_BASE = "https://grsaiapi.com/v1"
KEY_NAMES = {
    "deepseek": "DEEPSEEK_API_KEY",
    "fluxport": "FLUXPORT_LLM_API_KEY",
    "grsai": "GRSAI_LLM_API_KEY",
    "g4f": "G4F_ENABLED",
}


def _https_v1_endpoint(value: str) -> str:
    value = value.strip().rstrip("/")
    for suffix in ("/chat/completions",):
        if value.endswith(suffix):
            value = value[: -len(suffix)]
    parts = urlsplit(value)
    if (
        parts.scheme != "https"
        or not parts.hostname
        or parts.username
        or parts.password
        or parts.query
        or parts.fragment
    ):
        raise ValueError("请填写不含密钥、参数的 HTTPS 接口地址")
    return value if value.endswith("/v1") else value + "/v1"


class ModelSettings(BaseModel):
    provider: Literal["deepseek", "fluxport", "grsai", "g4f"] = "deepseek"
    fluxport_base_url: str = FLUXPORT_BASE
    fluxport_model: Literal["gpt-6-sol"] = "gpt-6-sol"
    grsai_base_url: str = GRSAI_BASE
    grsai_model: Literal["gemini-3.1-pro"] = "gemini-3.1-pro"
    g4f_model: Literal["gemini-3.1-pro", "gemini-2.5-flash", "gemini-2.0-flash"] = "gemini-2.5-flash"
    # g4f Gemini: low = no expanded thinking (default); medium/high turn it on
    g4f_thinking: Literal["low", "medium", "high"] = "low"

    @field_validator("provider", mode="before")
    @classmethod
    def remap_legacy(cls, value):
        # gemini_web was abandoned; old saved settings remap here
        return "g4f" if value == "gemini_web" else value

    @field_validator("fluxport_base_url", "grsai_base_url")
    @classmethod
    def endpoint(cls, value):
        return _https_v1_endpoint(value)


def worker_config(config, model_settings):
    selected = ModelSettings.model_validate(model_settings)
    cfg = {
        **config,
        "quick_think_provider": None,
        "deep_think_provider": None,
        "quick_think_backend_url": None,
        "deep_think_backend_url": None,
    }
    if selected.provider == "fluxport":
        key = os.environ.get("FLUXPORT_LLM_API_KEY", "").strip().removeprefix("Bearer ").strip()
        if not key:
            raise ValueError("Fluxport LLM 密钥未配置")
        # Each worker is an isolated process. Do not expose credentials in a job
        # snapshot or accidentally reuse the DeepSeek/native OpenAI credential.
        os.environ["OPENAI_COMPATIBLE_API_KEY"] = key
        cfg.update(
            llm_provider="openai_compatible",
            backend_url=selected.fluxport_base_url,
            quick_think_llm=selected.fluxport_model,
            deep_think_llm=selected.fluxport_model,
        )
    elif selected.provider == "grsai":
        # Same OpenAI-compatible chat path as poppic (grsaiapi.com /v1/chat/completions).
        key = (
            os.environ.get("GRSAI_LLM_API_KEY", "")
            or os.environ.get("GRSAI_API_KEY", "")
        ).strip().removeprefix("Bearer ").strip()
        if not key:
            raise ValueError("GrsAI LLM 密钥未配置")
        os.environ["OPENAI_COMPATIBLE_API_KEY"] = key
        cfg.update(
            llm_provider="openai_compatible",
            backend_url=selected.grsai_base_url,
            quick_think_llm=selected.grsai_model,
            deep_think_llm=selected.grsai_model,
        )
    elif selected.provider == "g4f":
        cfg.update(
            llm_provider="g4f",
            backend_url=None,
            quick_think_llm=selected.g4f_model,
            deep_think_llm=selected.g4f_model,
            g4f_thinking=selected.g4f_thinking,
        )
    else:
        cfg.update(
            llm_provider="deepseek",
            backend_url="https://api.deepseek.com",
            quick_think_llm="deepseek-flash",
            deep_think_llm="deepseek-v4-pro",
        )
    return cfg
