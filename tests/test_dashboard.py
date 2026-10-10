"""Offline integration checks for persistent scheduling, holdings and notifications."""
import json
import re
from datetime import datetime

import pytest
pytest.importorskip("fastapi")
from fastapi.testclient import TestClient
from pydantic import ValidationError

from dashboard.core import Settings, Store, TZ, next_due, should_notify
from dashboard.server import Engine, create_app
import dashboard.server as server


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "key_present", lambda *args: True)
    with TestClient(create_app(tmp_path, background=False)) as client:
        token = client.get("/api/state").json()["csrf"]
        client.headers["X-Dashboard-Token"] = token
        yield client


def test_local_ui_and_api_guard(client):
    assert client.get("/").status_code == 200
    html = client.get("/").text
    asset = re.search(r'src="(/static/assets/[^\"]+\.js)"', html)
    assert asset, "Build the Vite frontend before testing the dashboard"
    assert client.get(asset.group(1)).status_code == 200
    assert client.get("/api/state", headers={"Host": "evil.example"}).status_code == 403
    assert client.post("/api/run", json={"ticker": "NVDA"}, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/run", json={"ticker": "NVDA"}, headers={"X-Dashboard-Token": "wrong"}).status_code == 403


def test_settings_persist_and_snapshot_holdings(client):
    settings = Settings(watchlist=["700.HK", "0700.HK"], portfolio={"enabled": True, "currency": "HKD"})
    assert client.post("/api/settings", json=settings.model_dump()).status_code == 200
    payload = {"kind": "opening", "occurred_at": "2026-10-01T10:00:00+08:00", "ticker": "0700.HK", "quantity": 100, "price": 400}
    assert client.post("/api/portfolio/entries", json=payload).status_code == 200
    state = client.get("/api/state").json()
    assert state["settings"]["watchlist"] == ["0700.HK"]
    ids = client.post("/api/run", json={}).json()["ids"]
    assert len(ids) == 1
    assert client.post("/api/portfolio/entries", json=payload).status_code == 200
    # Stale settings saves cannot overwrite ledger-derived holdings.
    client.post("/api/settings", json=settings.model_dump())
    job = client.get("/api/job/" + ids[0]).json()
    assert job["settings"]["portfolio"]["positions"][0]["quantity"] == 100
    assert Store(client.app.state.store.folder).config()[0].portfolio.positions[0].quantity == 200


def test_duplicate_run_cancel_and_requeue(client):
    a = client.post("/api/run", json={"ticker": "NVDA"}).json()["ids"]
    assert len(a) == 1
    assert client.post("/api/run", json={"ticker": "NVDA"}).json()["ids"] == []
    assert client.post("/api/cancel/" + a[0]).status_code == 200
    assert client.get("/api/job/" + a[0]).json()["status"] == "cancelled"
    assert client.get("/api/state").json()["jobs"] == []
    # Hidden from activity, but still available to terminate the live worker.
    assert client.app.state.store.job(a[0])["status"] == "cancelled"
    assert len(client.post("/api/run", json={"ticker": "NVDA"}).json()["ids"]) == 1


def test_missing_key_prevents_paid_tasks(client, monkeypatch):
    monkeypatch.setattr(server, "key_present", lambda *args: False)
    assert client.post("/api/run", json={"ticker": "NVDA"}).status_code == 400
    settings = Settings(watchlist=["NVDA"], schedule_enabled=True)
    assert client.post("/api/settings", json=settings.model_dump()).status_code == 400
    assert client.get("/api/state").json()["jobs"] == []


@pytest.mark.parametrize("ticker", ["../.env", "<script>", "a/b", "", "x" * 30])
def test_invalid_symbols(client, ticker):
    assert client.post("/api/run", json={"ticker": ticker}).status_code == 400


def test_invalid_dates_and_numeric_fields(client):
    assert client.post("/api/run", json={"ticker": "NVDA", "date": "2999-01-01"}).status_code == 400
    assert client.post("/api/run", json={"ticker": "NVDA", "date": "invalid"}).status_code == 400
    with pytest.raises(ValidationError):
        Settings(portfolio={"cash": -5})
    with pytest.raises(ValidationError):
        Settings(portfolio={"cash": float("nan")})
    with pytest.raises(ValidationError):
        Settings(daily_time="99:99")
    with pytest.raises(ValidationError):
        Settings(analysts=[])


def test_key_not_echoed_and_permissions(client, tmp_path, monkeypatch):
    monkeypatch.setattr(server, "ROOT", tmp_path)
    key = "test-key-only-not-real"
    result = client.post("/api/key", json={"key": key})
    assert result.status_code == 200
    assert key not in result.text
    assert key not in client.get("/api/state").text
    assert (tmp_path / ".env").stat().st_mode & 0o777 == 0o600
    result = client.post("/api/key", json={"key": "short"})
    assert "short" not in result.text
    assert result.status_code == 422


def test_next_due_weekday_and_interval():
    friday = datetime(2026, 10, 9, 17, 0, tzinfo=TZ)
    daily = Settings(schedule_enabled=True, daily_time="16:30")
    assert next_due(daily, friday) == datetime(2026, 10, 12, 16, 30, tzinfo=TZ)
    daily.weekdays_only = False
    assert next_due(daily, friday) == datetime(2026, 10, 10, 16, 30, tzinfo=TZ)
    interval = Settings(schedule_enabled=True, schedule_mode="interval", interval_minutes=60)
    assert next_due(interval, friday) == datetime(2026, 10, 9, 18, 0, tzinfo=TZ)
    assert next_due(Settings(), friday) is None


def test_due_schedule_catches_up_once_and_persists(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "key_present", lambda *args: True)
    store = Store(tmp_path)
    settings = Settings(watchlist=["NVDA"], schedule_enabled=True, schedule_mode="interval", weekdays_only=False)
    store.save(settings)
    with store.connect() as conn:
        conn.execute("UPDATE config SET next_due='2026-10-09T12:00:00+08:00'")
    engine = Engine(store)
    at = datetime(2026, 10, 10, 12, 0, tzinfo=TZ)
    engine.schedule(at)
    engine.schedule(at)
    assert len(store.jobs()) == 1
    assert store.jobs()[0]["source"] == "scheduled"
    assert store.jobs()[0]["trade_date"] == "2026-10-10"
    assert Store(tmp_path).config()[1] == "2026-10-10T13:00:00+08:00"


def test_weekend_skip_and_missing_key_notice(tmp_path, monkeypatch):
    store = Store(tmp_path)
    settings = Settings(watchlist=["NVDA"], schedule_enabled=True)
    store.save(settings)
    with store.connect() as conn:
        conn.execute("UPDATE config SET next_due='2026-10-09T16:30:00+08:00'")
    engine = Engine(store)
    engine.schedule(datetime(2026, 10, 10, 12, 0, tzinfo=TZ))
    assert not store.jobs()
    monkeypatch.setattr(server, "key_present", lambda *args: False)
    engine.schedule(datetime(2026, 10, 12, 18, 0, tzinfo=TZ))
    assert not store.jobs()
    assert len(store.notifications()) == 1


@pytest.mark.parametrize("mode,prev,current,expected", [("changes",None,"Hold",False),("changes",None,"Buy",True),("changes","Buy","Buy",False),("changes","Buy","Hold",True),("all","Hold","Hold",True)])
def test_notification_policy(mode, prev, current, expected):
    assert should_notify(mode, prev, current) == expected


def test_worker_result_becomes_report_and_inbox(client, monkeypatch):
    store = client.app.state.store
    jid = client.post("/api/run", json={"ticker": "AAPL"}).json()["ids"][0]
    monkeypatch.setattr(server, "dotenv_values", lambda _: {"DEEPSEEK_API_KEY": "new-test-key"})
    monkeypatch.setenv("DEEPSEEK_API_KEY", "old-test-key")

    class CompletedProcess:
        def __init__(self, args, **kwargs):
            assert kwargs["env"]["DEEPSEEK_API_KEY"] == "new-test-key"
            folder = store.folder / "runs" / jid
            (folder / "result.json").write_text(json.dumps({"rating": "Buy", "reports": {"final_trade_decision": "买入研究依据"}}))
            (folder / "report").mkdir()
            (folder / "report/complete_report.html").write_text("<h1>Report</h1>")

        def poll(self):
            return 0

    monkeypatch.setattr(server.subprocess, "Popen", CompletedProcess)
    client.app.state.engine.run(store.claim())
    job = client.get("/api/job/" + jid).json()
    assert job["status"] == "completed" and job["rating"] == "Buy"
    assert job["result"]["reports"]["final_trade_decision"] == "买入研究依据"
    assert client.get("/api/report/" + jid).status_code == 404
    state = client.get("/api/state").json()
    assert len(state["notifications"]) == 1
    assert state["notifications"][0]["seen"] == 0
    client.post("/api/notifications/read", json={})
    assert client.get("/api/state").json()["notifications"][0]["seen"] == 1


def test_worker_failure_becomes_actionable_message(client, monkeypatch):
    store = client.app.state.store
    client.post("/api/run", json={"ticker": "AAPL"})
    def fail(*a, **kw):
        raise OSError("test network failure")
    monkeypatch.setattr(server.subprocess, "Popen", fail)
    client.app.state.engine.run(store.claim())
    assert store.jobs()[0]["status"] == "failed"
    assert "test network failure" in store.jobs()[0]["error"]
    assert len(store.notifications()) == 1


def test_delete_incomplete_job_and_live_transcript(client, monkeypatch):
    store = client.app.state.store
    jid = client.post("/api/run", json={"ticker": "AMD"}).json()["ids"][0]
    run = store.folder / "runs" / jid
    run.mkdir(parents=True)
    (run / "events.jsonl").write_text(
        '{"type":"stage","stage":"Market Analyst","at":1}\n'
        '{"type":"text","stage":"Market Analyst","text":"趋势观察","at":2}\n',
        encoding="utf-8",
    )
    live = client.get(f"/api/job/{jid}/live").json()
    assert live["events"][0]["stage"] == "Market Analyst"
    assert live["events"][1]["text"] == "趋势观察"
    assert client.post(f"/api/job/{jid}/delete").status_code == 400
    def fail(*a, **kw):
        raise OSError("boom")
    monkeypatch.setattr(server.subprocess, "Popen", fail)
    client.app.state.engine.run(store.claim())
    assert store.jobs()[0]["status"] == "failed"
    assert client.post(f"/api/job/{jid}/delete").status_code == 200
    assert store.jobs() == []
    assert client.get(f"/api/job/{jid}").status_code == 404


def test_memory_reads_original_log(client, monkeypatch, tmp_path):
    from tradingagents.memory import TradingMemoryLog
    config = {"memory_log_path": str(tmp_path / "original.md"), "holding_period_days": 5}
    TradingMemoryLog(config).store_decision("AAPL", "2026-10-09", "Hold", rating="Hold")
    monkeypatch.setattr(server, "build_default_config", lambda: config)
    data = client.get("/api/memory").json()
    assert data["entries"][0]["ticker"] == "AAPL"
    assert data["entries"][0]["pending"] is True
