"""One isolated model run. No credentials or prompts are sent to the browser."""
from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
from pathlib import Path

from langchain_core.callbacks import BaseCallbackHandler

from tradingagents.default_config import build_default_config
from tradingagents.dataflows.symbols import crypto_base
from tradingagents.graph.trading_graph import TradingAgentsGraph
from tradingagents.portfolio import PortfolioContext
from dashboard.models import worker_config

_SKIP_NODES = frozenset({"tools", "agent", "wrap_up", "__start__"})


def atomic_json(path, value):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, default=str), encoding="utf-8")
    tmp.replace(path)


def _content_text(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                parts.append(str(item.get("text") or ""))
            else:
                parts.append(getattr(item, "text", None) or str(item))
        return "".join(parts)
    return str(value)


class Progress(BaseCallbackHandler):
    """Writes current stage for the UI, plus an ephemeral events.jsonl transcript."""

    def __init__(self, progress_path, events_path):
        self.progress_path = progress_path
        self.events_path = events_path
        self.lock = threading.Lock()
        self.stage = "启动分析"
        self.events_path.write_text("", encoding="utf-8")
        self._emit({"type": "stage", "stage": self.stage})

    def _emit(self, event):
        event = {**event, "at": time.time()}
        line = json.dumps(event, ensure_ascii=False) + "\n"
        with self.lock:
            if event.get("type") == "stage":
                atomic_json(self.progress_path, {"stage": event["stage"]})
            with self.events_path.open("a", encoding="utf-8") as handle:
                handle.write(line)

    def on_chain_start(self, serialized, inputs, **kwargs):
        name = (kwargs.get("metadata") or {}).get("langgraph_node")
        if name and name not in _SKIP_NODES and name != self.stage:
            self.stage = name
            self._emit({"type": "stage", "stage": name})

    def on_llm_end(self, response, **kwargs):
        texts = []
        for generations in getattr(response, "generations", []) or []:
            for generation in generations:
                message = getattr(generation, "message", None)
                text = _content_text(
                    getattr(message, "content", None) if message is not None else getattr(generation, "text", None)
                )
                if text.strip():
                    texts.append(text.strip())
        body = "\n".join(texts).strip()
        if body:
            # ponytail: full turn text, not token stream (LLMs here are non-streaming)
            self._emit({"type": "text", "stage": self.stage, "text": body[:8000]})


def safe_error(exc):
    value = str(exc)
    for key, secret in os.environ.items():
        if any(part in key for part in ("API_KEY", "TOKEN", "SECRET")) and len(secret) > 5:
            value = value.replace(secret, "[redacted]")
    value = re.sub(r"sk-[A-Za-z0-9_-]+", "[redacted]", value)
    return f"{type(exc).__name__}: {value[:600]}"


def main(folder):
    folder = Path(folder)
    request = json.loads((folder / "request.json").read_text())
    cfg = build_default_config()
    settings = request["settings"]
    book = settings["portfolio"]
    portfolio = PortfolioContext.model_validate({k: v for k, v in book.items() if k != "enabled"}) if book["enabled"] else None
    analysts = settings["analysts"]
    kind = "crypto" if crypto_base(request["ticker"]) else "stock"
    if kind == "crypto":
        analysts = [a for a in analysts if a != "fundamentals"]
        if not analysts:
            analysts = ["market"]
    try:
        cfg = worker_config(cfg, settings.get("models", {}))
        progress = Progress(folder / "progress.json", folder / "events.jsonl")
        graph = TradingAgentsGraph(selected_analysts=analysts, config=cfg, callbacks=[progress])
        state, rating = graph.propagate(request["ticker"], request["trade_date"], asset_type=kind, portfolio=portfolio)
        fields = ("market_report", "sentiment_report", "news_report", "fundamentals_report", "investment_plan", "trader_investment_plan", "final_trade_decision", "memory_note")
        result = {"rating": rating, "reports": {k: state.get(k, "") for k in fields}}
        # Markdown sections are served in the UI tabs; skip HTML export.
        try:
            graph.save_reports(state, request["ticker"], save_path=folder / "report", html=False)
        except Exception:
            pass
        atomic_json(folder / "result.json", result)
        progress._emit({"type": "stage", "stage": "分析完成"})
    except Exception as exc:
        atomic_json(folder / "error.json", {"error": safe_error(exc)})
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1])
