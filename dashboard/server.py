from __future__ import annotations

import fcntl
import json
import os
import secrets
import signal
import subprocess
import sys
import threading
import time
import sqlite3
import tempfile
from contextlib import asynccontextmanager
from datetime import date, datetime
from pathlib import Path

from dotenv import dotenv_values, set_key
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from dashboard.core import RATINGS, Settings, Store, TZ, next_due, now, should_notify, symbol
from dashboard.ledger import Entry, mutate as mutate_ledger, snapshot as ledger_snapshot
from dashboard.models import KEY_NAMES
from typing import Literal
from tradingagents.default_config import build_default_config
from tradingagents.memory import TradingMemoryLog

ROOT = Path(__file__).resolve().parent.parent
STATIC = Path(__file__).parent / "static"
DATA = Path(os.getenv("TRADINGAGENTS_DASHBOARD_DIR", Path.home() / ".tradingagents/dashboard"))


G4F_COOKIE_FILE = Path.home() / ".g4f/cookies/google.json"


def g4f_cookies_configured() -> bool:
    if not G4F_COOKIE_FILE.is_file():
        return False
    try:
        raw = json.loads(G4F_COOKIE_FILE.read_text())
    except (OSError, json.JSONDecodeError):
        return False
    if isinstance(raw, list):
        names = {c.get("name") for c in raw if isinstance(c, dict)}
        return "__Secure-1PSID" in names
    return isinstance(raw, dict) and bool(raw.get("__Secure-1PSID"))


def save_g4f_cookie_json(text: str) -> None:
    """Persist EditThisCookie JSON for g4f Gemini Pro."""
    text = text.strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("Cookie 须为合法 JSON（EditThisCookie 导出格式）") from exc
    if isinstance(data, list):
        names = {c.get("name") for c in data if isinstance(c, dict)}
        if "__Secure-1PSID" not in names:
            raise ValueError("JSON 中缺少 __Secure-1PSID")
    elif isinstance(data, dict):
        if not data.get("__Secure-1PSID"):
            raise ValueError("JSON 中缺少 __Secure-1PSID")
    else:
        raise ValueError("Cookie JSON 须为数组或对象")
    G4F_COOKIE_FILE.parent.mkdir(parents=True, exist_ok=True)
    G4F_COOKIE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    G4F_COOKIE_FILE.chmod(0o600)


def key_value(provider="deepseek"):
    if provider == "g4f":
        return "1"
    name = KEY_NAMES[provider]
    env = dotenv_values(ROOT / ".env")
    raw = (env.get(name) or os.getenv(name) or "").strip()
    # poppic: GrsAI chat often shares GRSAI_API_KEY when LLM-specific env is unset
    if provider == "grsai" and not raw:
        raw = (env.get("GRSAI_API_KEY") or os.getenv("GRSAI_API_KEY") or "").strip()
    return raw.removeprefix("Bearer ").strip()


def key_present(provider="deepseek"):
    return bool(key_value(provider))


def key_mask(provider="deepseek"):
    if provider == "g4f":
        return None
    raw = key_value(provider)
    if len(raw) < 8:
        return None
    keep = 4
    return f"{raw[:keep]}{'•' * max(6, len(raw) - 2 * keep)}{raw[-keep:]}"


class RunRequest(BaseModel):
    ticker: str | None = None
    date: str | None = None


class KeyRequest(BaseModel):
    provider: Literal["deepseek", "fluxport", "grsai", "g4f"] = "deepseek"
    key: str = Field(min_length=8, max_length=200000)


class Engine:
    def __init__(self, store):
        self.store = store
        self.stop_event = threading.Event()
        self.process = None

    def start(self):
        # Interrupted runs are explicit; never silently replay paid calls on restart.
        with self.store.connect() as conn:
            conn.execute("UPDATE jobs SET status='interrupted',stage='服务重启，请手动重试' WHERE status='running'")
        self.thread = threading.Thread(target=self.loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.process and self.process.poll() is None:
            self.kill(self.process)
        self.thread.join(timeout=8)

    @staticmethod
    def kill(process):
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=3)
        except ProcessLookupError:
            pass

    def schedule(self, at=None):
        at = at or now()
        with self.store.lock:
            settings, due = self.store.config()
            if not settings.schedule_enabled or not due or datetime.fromisoformat(due) > at:
                return
            # After sleep/restart, run at most one batch; do not backfill all missed slots.
            nxt = next_due(settings, at)
            with self.store.connect() as conn:
                conn.execute("UPDATE config SET next_due=? WHERE id=1", (nxt.isoformat() if nxt else None,))
            if settings.weekdays_only and at.astimezone(TZ).weekday() >= 5:
                return
            if not key_present(settings.models.provider):
                self.store.notice("自动分析未运行", "请在模型配置中填写当前服务的 API Key。")
                return
            tickers = list(dict.fromkeys(settings.watchlist + ([p.ticker for p in settings.portfolio.positions] if settings.portfolio.enabled else [])))
            if tickers:
                self.store.queue(tickers, settings, source="scheduled", date=at.astimezone(TZ).date().isoformat())
            else:
                self.store.notice("自动分析未运行", "自选股和已启用的持仓中没有股票，请先添加。")

    def loop(self):
        while not self.stop_event.is_set():
            try:
                self.schedule()
                job = self.store.claim()
                if job:
                    self.run(job)
                    continue
            except Exception:
                import logging
                logging.getLogger(__name__).exception("Dashboard background loop failed")
            self.stop_event.wait(2)

    def run(self, job):
        folder = self.store.folder / "runs" / job["id"]
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        settings = Settings.model_validate_json(job["settings"])
        request = {"ticker": job["ticker"], "trade_date": job["trade_date"], "settings": settings.model_dump()}
        (folder / "request.json").write_text(json.dumps(request), encoding="utf-8")
        try:
            with (folder / "worker.log").open("w") as log:
                # The server may have started before the key was edited in the UI.
                # Fresh .env values must win over credentials inherited at launch.
                env = os.environ.copy()
                env.update({k: v for k, v in dotenv_values(ROOT / ".env").items() if v is not None})
                self.process = subprocess.Popen([sys.executable, "-m", "dashboard.worker", str(folder)], cwd=ROOT, env=env, stdout=log, stderr=log, start_new_session=True)
                start = time.monotonic()
                stage = ""
                while self.process.poll() is None:
                    current = self.store.job(job["id"])
                    if self.stop_event.is_set() or current["status"] == "cancelled":
                        self.kill(self.process)
                        if self.stop_event.is_set() and current["status"] != "cancelled":
                            self.store.update(job["id"], status="interrupted", stage="服务已停止，可重试")
                        return
                    if time.monotonic() - start > 2700:
                        self.kill(self.process)
                        raise TimeoutError("本次分析超过 45 分钟，请检查模型和网络后重试。")
                    progress = folder / "progress.json"
                    if progress.exists():
                        value = json.loads(progress.read_text())["stage"]
                        if value != stage:
                            self.store.update(job["id"], stage=value)
                            stage = value
                    self.stop_event.wait(1)
                if self.store.job(job["id"])["status"] == "cancelled":
                    return
                if (folder / "error.json").exists():
                    raise RuntimeError(json.loads((folder / "error.json").read_text())["error"])
                result = json.loads((folder / "result.json").read_text())
                previous = self.store.previous_rating(job)
                with self.store.lock:
                    if self.store.job(job["id"])["status"] == "cancelled":
                        return
                    self.store.update(job["id"], status="completed", stage="分析完成", rating=result["rating"], result=json.dumps(result, ensure_ascii=False))
                # Notification preferences apply at completion, not at queue time.
                prefs, _ = self.store.config()
                if should_notify(prefs.notify_mode, previous, result["rating"]):
                    title = f"{job['ticker']} · {RATINGS.get(result['rating'], result['rating'])}"
                    body = f"{RATINGS.get(previous, '首次分析')} → {RATINGS.get(result['rating'], result['rating'])}。打开研究报告查看依据。"
                    self.store.notice(title, body, job["id"])
        except Exception as exc:
            if self.store.job(job["id"])["status"] != "cancelled":
                self.store.update(job["id"], status="failed", stage="分析未完成", error=str(exc)[:800])
                self.store.notice(f"{job['ticker']} 分析未完成", "请打开任务查看原因并重试。", job["id"])
        finally:
            self.process = None


def create_app(folder=DATA, background=True):
    store = Store(folder)
    engine = Engine(store)
    token = secrets.token_urlsafe(32)

    @asynccontextmanager
    async def lifespan(app):
        if background:
            lock = (store.folder / "server.lock").open("w")
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError("Dashboard is already running") from None
            engine.start()
        yield
        if background:
            engine.stop()
            lock.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store = store
    app.state.engine = engine

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Do not echo submitted keys/holdings in validation responses.
        return JSONResponse({"detail": [{"msg": e["msg"], "loc": e["loc"]} for e in exc.errors()]}, status_code=422)

    @app.middleware("http")
    async def local_only(request, call_next):
        host = request.headers.get("host", "")
        if host not in ("127.0.0.1:8765", "localhost:8765", "testserver"):
            return JSONResponse({"detail": "仅支持本机访问"}, status_code=403)
        origin = request.headers.get("origin")
        if origin and origin not in (f"http://{host}", "http://testserver"):
            return JSONResponse({"detail": "请求来源不匹配"}, status_code=403)
        if request.method not in ("GET", "HEAD") and not secrets.compare_digest(request.headers.get("x-dashboard-token", ""), token):
            return JSONResponse({"detail": "页面会话已更新，请刷新后再试"}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://assets.parqet.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
        return response

    @app.get("/api/state")
    def state():
        settings, due = store.config()
        return {
            "csrf": token,
            "settings": settings.model_dump(),
            "next_due": due,
            "jobs": store.jobs(),
            "notifications": store.notifications(),
            "key_configured": key_present(settings.models.provider),
            "provider_keys": {p: key_present(p) for p in KEY_NAMES},
            "provider_key_masks": {p: key_mask(p) for p in KEY_NAMES},
            "g4f_cookies_configured": g4f_cookies_configured(),
            "storage": {"database": str(store.db), "persistent": True},
            "today": now().date().isoformat(),
            "version": "0.6.0",
            "timezone": "Asia/Shanghai",
        }

    @app.post("/api/settings")
    def save_settings(settings: Settings):
        if settings.schedule_enabled and not (settings.watchlist or (settings.portfolio.enabled and settings.portfolio.positions)):
            raise HTTPException(400, "请先添加自选股或启用有持仓的账户")
        if settings.schedule_enabled and not key_present(settings.models.provider):
            raise HTTPException(400, "请先配置当前模型服务的 API Key，再开启自动运行")
        try:
            store.save(settings)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
        return {"ok": True}

    @app.post("/api/key")
    def save_key(payload: KeyRequest):
        key = payload.key.strip().removeprefix("Bearer ").strip()
        if payload.provider == "g4f":
            try:
                with store.lock:
                    save_g4f_cookie_json(key)
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from None
            return {"ok": True, "g4f_cookies_configured": True}
        if len(key) < 8 or any(ch.isspace() for ch in key) or "'" in key or '"' in key:
            raise HTTPException(400, "密钥不能包含空白或引号")
        with store.lock:
            set_key(str(ROOT / ".env"), KEY_NAMES[payload.provider], key)
            (ROOT / ".env").chmod(0o600)
        return {"ok": True}

    @app.post("/api/run")
    def run(payload: RunRequest):
        settings, _ = store.config()
        if not key_present(settings.models.provider):
            raise HTTPException(400, "请先在模型配置中填写当前服务的 API Key")
        try:
            tickers = [symbol(payload.ticker)] if payload.ticker else list(dict.fromkeys(settings.watchlist + ([p.ticker for p in settings.portfolio.positions] if settings.portfolio.enabled else [])))
            run_date = date.fromisoformat(payload.date) if payload.date else now().date()
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
        if run_date > now().date():
            raise HTTPException(400, "分析日期不能在未来")
        if not tickers:
            raise HTTPException(400, "请先添加自选股，或输入要分析的股票")
        ids = store.queue(tickers, settings, date=run_date.isoformat())
        return {"ids": ids, "message": f"已加入 {len(ids)} 个分析任务" if ids else "这些股票已在分析队列中"}

    @app.get("/api/portfolio")
    def portfolio():
        return ledger_snapshot(store)

    @app.get("/api/tickers/search")
    def ticker_search(q: str = ""):
        query = q.strip()
        if len(query) < 1 or len(query) > 32:
            return {"results": []}
        settings, _ = store.config()
        needle = query.upper()
        local, seen = [], set()
        for ticker in list(settings.watchlist) + [p.ticker for p in settings.portfolio.positions]:
            if needle in ticker.upper() and ticker not in seen:
                seen.add(ticker)
                local.append({"symbol": ticker, "name": "自选 / 持仓", "exchange": ""})
        try:
            import yfinance as yf

            quotes = yf.Search(query, max_results=8).quotes or []
        except Exception:
            quotes = []
        remote = []
        for item in quotes:
            sym = (item.get("symbol") or "").strip()
            if not sym or sym in seen:
                continue
            seen.add(sym)
            remote.append({
                "symbol": sym,
                "name": item.get("shortname") or item.get("longname") or "",
                "exchange": item.get("exchDisp") or item.get("exchange") or "",
            })
        return {"results": (local + remote)[:8]}

    @app.post("/api/portfolio/entries")
    def add_entry(entry: Entry):
        try:
            mutate_ledger(store, entry=entry)
            return ledger_snapshot(store)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None

    @app.post("/api/portfolio/entries/{entry_id}/delete")
    def delete_entry(entry_id: str):
        try:
            mutate_ledger(store, delete_id=entry_id)
            return ledger_snapshot(store)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None

    @app.get("/api/backup")
    def backup():
        # SQLite's backup API produces a consistent snapshot even during writes.
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "dashboard.db"
            with store.connect() as source, sqlite3.connect(path) as target:
                source.backup(target)
            return Response(path.read_bytes(), media_type="application/octet-stream", headers={"Content-Disposition": f'attachment; filename="tradingagents-{now():%Y%m%d-%H%M%S}.db"'})

    @app.post("/api/cancel/{jid}")
    def cancel(jid: str):
        with store.lock:
            job = store.job(jid)
            if not job or job["status"] not in ("queued", "running"):
                raise HTTPException(400, "任务已结束或不存在")
            store.update(jid, status="cancelled", stage="已取消")
        return {"ok": True}

    @app.post("/api/job/{jid}/delete")
    def delete_job(jid: str):
        try:
            if not store.remove(jid):
                raise HTTPException(404, "记录不存在")
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
        return {"ok": True}

    @app.get("/api/job/{jid}")
    def job_detail(jid: str):
        job = store.job(jid)
        if not job:
            raise HTTPException(404, "记录不存在")
        job["result"] = json.loads(job["result"]) if job["result"] else None
        job["settings"] = json.loads(job["settings"])
        return job

    @app.get("/api/job/{jid}/live")
    def job_live(jid: str):
        job = store.job(jid)
        if not job:
            raise HTTPException(404, "记录不存在")
        path = store.folder / "runs" / jid / "events.jsonl"
        events = []
        if path.exists():
            # ponytail: last 120 lines only; transcript is ephemeral viewing aid
            lines = path.read_text(encoding="utf-8").splitlines()[-120:]
            for line in lines:
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return {"status": job["status"], "stage": job["stage"], "events": events}

    @app.get("/api/memory")
    def memory():
        config = build_default_config()
        entries = TradingMemoryLog(config).load_entries()
        return {"entries": list(reversed(entries[-200:])), "total": len(entries), "holding_days": config.get("holding_period_days", 5)}

    @app.post("/api/notifications/read")
    def read():
        store.acknowledge()
        return {"ok": True}

    @app.get("/")
    def index():
        return FileResponse(STATIC / "index.html")

    app.mount("/static", StaticFiles(directory=STATIC), name="static")
    return app


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(create_app(), host="127.0.0.1", port=8765, log_level="warning")
