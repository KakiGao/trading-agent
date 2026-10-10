"""Dashboard provider selection, independent credentials and worker mapping."""
import os
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, field_validator

FLUXPORT_BASE = "https://api.uselg.top/v1"
KEY_NAMES = {"deepseek": "DEEPSEEK_API_KEY", "fluxport": "FLUXPORT_LLM_API_KEY"}


class ModelSettings(BaseModel):
    provider: Literal["deepseek", "fluxport"] = "deepseek"
    fluxport_base_url: str = FLUXPORT_BASE
    fluxport_model: Literal["gpt-6-sol"] = "gpt-6-sol"

    @field_validator("fluxport_base_url")
    @classmethod
    def endpoint(cls, value):
        value = value.strip().rstrip('/')
        for suffix in ("/chat/completions",):
            if value.endswith(suffix):
                value = value[:-len(suffix)]
        parts = urlsplit(value)
        if parts.scheme != "https" or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
            raise ValueError("请填写不含密钥、参数的 HTTPS 接口地址")
        return value if value.endswith('/v1') else value + '/v1'


def worker_config(config, model_settings):
    selected = ModelSettings.model_validate(model_settings)
    cfg = {**config, "quick_think_provider": None, "deep_think_provider": None, "quick_think_backend_url": None, "deep_think_backend_url": None}
    if selected.provider == "fluxport":
        key = os.environ.get("FLUXPORT_LLM_API_KEY", "").strip().removeprefix("Bearer ").strip()
        if not key:
            raise ValueError("Fluxport LLM 密钥未配置")
        # Each worker is an isolated process. Do not expose credentials in a job
        # snapshot or accidentally reuse the DeepSeek/native OpenAI credential.
        os.environ["OPENAI_COMPATIBLE_API_KEY"] = key
        cfg.update(llm_provider="openai_compatible", backend_url=selected.fluxport_base_url, quick_think_llm=selected.fluxport_model, deep_think_llm=selected.fluxport_model)
    else:
        cfg.update(llm_provider="deepseek", backend_url="https://api.deepseek.com", quick_think_llm="deepseek-flash", deep_think_llm="deepseek-v4-pro")
    return cfg
