"""gpt4free (g4f) client — Gemini via Provider.Gemini (Flash free; Pro needs cookies)."""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any

from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.utils.function_calling import convert_to_openai_tool
from pydantic import ConfigDict

from .base_client import BaseLLMClient
from .validators import validate_model

_TOOL_RE = re.compile(r"\{[^{}]*\"tool_calls\"\s*:\s*\[[\s\S]*?\]\s*\}")
_COOKIE_JSON = Path.home() / ".g4f/cookies/google.json"


def _load_google_cookies() -> dict[str, str] | None:
    """EditThisCookie-style JSON at ~/.g4f/cookies/google.json → name/value map."""
    if not _COOKIE_JSON.is_file():
        return None
    try:
        raw = json.loads(_COOKIE_JSON.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    if isinstance(raw, list):
        cookies = {c["name"]: c["value"] for c in raw if isinstance(c, dict) and c.get("name") and c.get("value")}
    elif isinstance(raw, dict):
        cookies = {str(k): str(v) for k, v in raw.items() if v}
    else:
        return None
    return cookies or None


def _to_openai_messages(messages: list[BaseMessage]) -> list[dict]:
    out = []
    for m in messages:
        if isinstance(m, SystemMessage):
            out.append({"role": "system", "content": str(m.content)})
        elif isinstance(m, HumanMessage):
            out.append({"role": "user", "content": str(m.content)})
        elif isinstance(m, AIMessage):
            text = m.content if isinstance(m.content, str) else ""
            if m.tool_calls:
                calls = "; ".join(
                    f"{c['name']}({json.dumps(c.get('args', {}), default=str)})" for c in m.tool_calls
                )
                text = f"{text}\n[Called {calls}]".strip()
            out.append({"role": "assistant", "content": text})
        elif isinstance(m, ToolMessage):
            out.append({"role": "user", "content": f"[Tool {m.name or 'result'}]\n{m.content}"})
        else:
            out.append({"role": "user", "content": str(getattr(m, "content", m))})
    return out


def _tool_prompt(tools) -> str:
    schemas = [convert_to_openai_tool(t) for t in tools]
    return (
        "You may call tools by replying with JSON only in this shape:\n"
        '{"tool_calls":[{"name":"tool_name","args":{...}}]}\n'
        "Otherwise answer in plain text. Available tools:\n"
        + json.dumps(schemas, ensure_ascii=False)
    )


def _parse_tool_calls(text: str) -> list[dict]:
    match = _TOOL_RE.search(text.strip())
    if not match:
        return []
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []
    out = []
    for call in data.get("tool_calls") or []:
        name = call.get("name")
        if not name:
            continue
        args = call.get("args") if isinstance(call.get("args"), dict) else {}
        out.append({"name": name, "args": args, "id": f"call_{uuid.uuid4().hex[:8]}", "type": "tool_call"})
    return out


class G4FChat(BaseChatModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    model_name: str = "gemini-2.5-flash"
    timeout: float = 180.0
    # g4f maps: none/minimal/low → no expanded thinking; medium/high/xhigh → expanded
    reasoning_effort: str | None = None

    @property
    def _llm_type(self) -> str:
        return "g4f"

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        from g4f import Provider
        from g4f.client import Client
        from g4f.cookies import set_cookies

        tools = kwargs.get("tools") or []
        openai_msgs = _to_openai_messages(messages)
        if tools:
            openai_msgs = [{"role": "system", "content": _tool_prompt(tools)}, *openai_msgs]
        cookies = _load_google_cookies()
        create_kwargs: dict[str, Any] = {
            "model": self.model_name,
            "messages": openai_msgs,
            "provider": Provider.Gemini,
            "web_search": False,
        }
        if self.reasoning_effort:
            create_kwargs["reasoning_effort"] = self.reasoning_effort
        if cookies:
            set_cookies(".google.com", cookies)
            create_kwargs["cookies"] = cookies
        client = Client()
        # Full reply per turn (not token stream); UI live-log reads on_llm_end.
        response = client.chat.completions.create(**create_kwargs)
        text = (response.choices[0].message.content or "").strip()
        tool_calls = _parse_tool_calls(text) if tools else []
        message = AIMessage(content="" if tool_calls else text, tool_calls=tool_calls)
        return ChatResult(generations=[ChatGeneration(message=message)])

    def bind_tools(self, tools, **kwargs):
        return self.bind(tools=tools, **kwargs)


class G4FClient(BaseLLMClient):
    provider = "g4f"

    def get_llm(self) -> Any:
        self.warn_if_unknown_model()
        timeout = float(self.kwargs.get("timeout", 180))
        llm_kwargs: dict[str, Any] = {"model_name": self.model, "timeout": timeout}
        effort = self.kwargs.get("reasoning_effort")
        if effort:
            llm_kwargs["reasoning_effort"] = effort
        if self.kwargs.get("callbacks"):
            llm_kwargs["callbacks"] = self.kwargs["callbacks"]
        return G4FChat(**llm_kwargs)

    def validate_model(self) -> bool:
        return validate_model("g4f", self.model)
