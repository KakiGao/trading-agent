"""One isolated model run. No credentials or prompts are sent to the browser."""
from __future__ import annotations

import json
import os
import re
import sys
import threading
from pathlib import Path

from langchain_core.callbacks import BaseCallbackHandler

from tradingagents.default_config import build_default_config
from tradingagents.dataflows.symbols import crypto_base
from tradingagents.graph.trading_graph import TradingAgentsGraph
from tradingagents.portfolio import PortfolioContext


def atomic_json(path, value):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, default=str), encoding="utf-8")
    tmp.replace(path)


class Progress(BaseCallbackHandler):
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()

    def on_chain_start(self, serialized, inputs, **kwargs):
        name = (kwargs.get("metadata") or {}).get("langgraph_node")
        if name and name not in ("tools", "agent", "wrap_up", "__start__"):
            with self.lock:
                atomic_json(self.path, {"stage": name})


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
        graph = TradingAgentsGraph(selected_analysts=analysts, config=cfg, callbacks=[Progress(folder / "progress.json")])
        state, rating = graph.propagate(request["ticker"], request["trade_date"], asset_type=kind, portfolio=portfolio)
        fields = ("market_report", "sentiment_report", "news_report", "fundamentals_report", "investment_plan", "trader_investment_plan", "final_trade_decision", "memory_note")
        result = {"rating": rating, "reports": {k: state.get(k, "") for k in fields}}
        # A report export failure must not erase a successfully recorded decision.
        try:
            graph.save_reports(state, request["ticker"], save_path=folder / "report")
        except Exception:
            result["export_warning"] = "HTML 导出未成功，仍可在页面查看各段报告。"
        atomic_json(folder / "result.json", result)
    except Exception as exc:
        atomic_json(folder / "error.json", {"error": safe_error(exc)})
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1])
