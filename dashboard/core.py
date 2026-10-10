from __future__ import annotations

import json
import re
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, field_validator, model_validator

from tradingagents.dataflows.symbols import normalize_symbol
from dashboard.models import ModelSettings

TZ = ZoneInfo("Asia/Shanghai")
RATINGS = {"Buy": "买入", "Overweight": "加仓", "Hold": "持有", "Underweight": "减仓", "Sell": "卖出", "REVIEW": "待复核"}


def now():
    return datetime.now(TZ)


def symbol(value):
    value = str(value).strip().upper()
    if not re.fullmatch(r"[A-Z0-9^][A-Z0-9.^=\-]{0,23}", value):
        raise ValueError("股票代码格式不正确，例如 NVDA、0700.HK、600519.SS")
    return normalize_symbol(value)


class Position(BaseModel):
    ticker: str
    quantity: float = Field(gt=0, allow_inf_nan=False)
    average_price: float = Field(ge=0, allow_inf_nan=False)

    _ticker = field_validator("ticker")(symbol)


class Book(BaseModel):
    enabled: bool = False
    cash: float = Field(default=0, ge=0, allow_inf_nan=False)
    currency: str = "USD"
    positions: list[Position] = Field(default_factory=list, max_length=100)

    @field_validator("currency")
    @classmethod
    def currency_valid(cls, value):
        if value not in ("USD", "HKD", "CNY", "JPY", "EUR", "GBP"):
            raise ValueError("请选择支持的账户币种")
        return value

    @model_validator(mode="after")
    def unique(self):
        if len({p.ticker for p in self.positions}) != len(self.positions):
            raise ValueError("同一股票请合并为一行持仓")
        return self


class Settings(BaseModel):
    models: ModelSettings = Field(default_factory=ModelSettings)
    watchlist: list[str] = Field(default_factory=list, max_length=50)
    portfolio: Book = Field(default_factory=Book)
    analysts: list[str] = Field(default_factory=lambda: ["market", "news", "fundamentals", "social"])
    schedule_enabled: bool = False
    schedule_mode: str = "daily"
    daily_time: str = "16:30"
    interval_minutes: int = Field(default=60, ge=15, le=1440)
    weekdays_only: bool = True
    notify_mode: str = "changes"

    @field_validator("watchlist")
    @classmethod
    def tickers(cls, values):
        return list(dict.fromkeys(symbol(s) for s in values))

    @field_validator("analysts")
    @classmethod
    def check_analysts(cls, values):
        if not values or not set(values) <= {"market", "news", "fundamentals", "social"}:
            raise ValueError("至少选择一类分析师")
        return list(dict.fromkeys(values))

    @field_validator("schedule_mode")
    @classmethod
    def mode(cls, value):
        if value not in ("daily", "interval"):
            raise ValueError("无效的自动运行方式")
        return value

    @field_validator("notify_mode")
    @classmethod
    def notify(cls, value):
        if value not in ("changes", "all"):
            raise ValueError("无效的提醒方式")
        return value

    @field_validator("daily_time")
    @classmethod
    def time_valid(cls, value):
        if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
            raise ValueError("时间格式应为 HH:MM")
        return value


def next_due(settings: Settings, after: datetime) -> datetime | None:
    if not settings.schedule_enabled:
        return None
    current = after.astimezone(TZ)
    if settings.schedule_mode == "interval":
        candidate = current + timedelta(minutes=settings.interval_minutes)
    else:
        hour, minute = map(int, settings.daily_time.split(":"))
        candidate = current.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= current:
            candidate += timedelta(days=1)
    while settings.weekdays_only and candidate.weekday() >= 5:
        candidate += timedelta(days=1)
    return candidate


def should_notify(mode, previous, current):
    if mode == "all":
        return True
    return current != previous and (previous is not None or current != "Hold")


class Store:
    def __init__(self, folder):
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = self.folder / "dashboard.db"
        self.lock = threading.RLock()
        # Preserve an on-disk copy before the first ledger schema migration.
        if self.db.exists():
            with self.connect() as source:
                if not source.execute("SELECT 1 FROM sqlite_master WHERE name='ledger_meta'").fetchone():
                    backup = self.folder / "before-ledger-migration.db"
                    if not backup.exists():
                        with sqlite3.connect(backup) as target:
                            source.backup(target)
                        backup.chmod(0o600)
        with self.connect() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY, body TEXT, next_due TEXT);
                CREATE TABLE IF NOT EXISTS jobs (
                  id TEXT PRIMARY KEY, ticker TEXT, trade_date TEXT, source TEXT,
                  status TEXT, created TEXT, updated TEXT, rating TEXT, stage TEXT,
                  error TEXT, result TEXT, settings TEXT);
                CREATE TABLE IF NOT EXISTS notifications (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, body TEXT,
                  job_id TEXT, created TEXT, seen INTEGER DEFAULT 0);
            """)
            conn.execute("INSERT OR IGNORE INTO config VALUES (1, ?, NULL)", (Settings().model_dump_json(),))
            from dashboard.ledger import initialize
            initialize(conn)
        self.db.chmod(0o600)

    def connect(self):
        conn = sqlite3.connect(self.db, timeout=15)
        conn.row_factory = sqlite3.Row
        return conn

    def config(self):
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM config WHERE id=1").fetchone()
        return Settings.model_validate_json(row["body"]), row["next_due"]

    def save(self, settings):
        with self.lock, self.connect() as conn:
            previous, due = self.config()
            if settings.portfolio.currency != previous.portfolio.currency and conn.execute("SELECT 1 FROM ledger_entries WHERE deleted_at IS NULL LIMIT 1").fetchone():
                raise ValueError("已有交易日志时不能更换账户币种；请先撤回全部记录")
            # Cash and positions are derived exclusively from the ledger. A stale
            # browser settings save must never overwrite a newer transaction.
            settings.portfolio.cash = previous.portfolio.cash
            settings.portfolio.positions = previous.portfolio.positions
            fields = ("schedule_enabled", "schedule_mode", "daily_time", "interval_minutes", "weekdays_only")
            if any(getattr(settings, k) != getattr(previous, k) for k in fields):
                nxt = next_due(settings, now())
                due = nxt.isoformat() if nxt else None
            conn.execute("UPDATE config SET body=?, next_due=? WHERE id=1", (settings.model_dump_json(), due))

    def queue(self, tickers, settings, source="manual", date=None):
        created = []
        with self.lock, self.connect() as conn:
            for ticker in tickers:
                ticker = symbol(ticker)
                if conn.execute("SELECT 1 FROM jobs WHERE ticker=? AND status IN ('queued','running')", (ticker,)).fetchone():
                    continue
                jid = uuid.uuid4().hex
                stamp = now().isoformat()
                conn.execute("INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (
                    jid, ticker, date or now().date().isoformat(), source, "queued", stamp, stamp,
                    None, "等待分析", None, None, settings.model_dump_json()))
                created.append(jid)
        return created

    def update(self, jid, **values):
        allowed = {"status", "rating", "stage", "error", "result"}
        if not set(values) <= allowed:
            raise ValueError("Unsupported job fields")
        values["updated"] = now().isoformat()
        with self.connect() as conn:
            conn.execute("UPDATE jobs SET " + ",".join(f"{key}=?" for key in values) + " WHERE id=?", (*values.values(), jid))

    def jobs(self):
        with self.connect() as conn:
            # Keep cancellation tombstones for the worker, but omit them from
            # visible activity before applying the history limit.
            rows = conn.execute("SELECT id,ticker,trade_date,source,status,created,updated,rating,stage,error FROM jobs WHERE status != 'cancelled' ORDER BY created DESC LIMIT 200").fetchall()
        return [dict(row) for row in rows]

    def job(self, jid):
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM jobs WHERE id=?", (jid,)).fetchone()
        return dict(row) if row else None

    def notice(self, title, body, jid=None):
        with self.connect() as conn:
            conn.execute("INSERT INTO notifications(title,body,job_id,created) VALUES (?,?,?,?)", (title, body, jid, now().isoformat()))

    def notifications(self):
        with self.connect() as conn:
            return [dict(row) for row in conn.execute("SELECT * FROM notifications ORDER BY id DESC LIMIT 100")]

    def acknowledge(self):
        with self.connect() as conn:
            conn.execute("UPDATE notifications SET seen=1 WHERE seen=0")

    def claim(self):
        with self.lock, self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
            if row:
                conn.execute("UPDATE jobs SET status='running',stage='启动分析',updated=? WHERE id=?", (now().isoformat(), row["id"]))
                return dict(row)

    def previous_rating(self, job):
        with self.connect() as conn:
            row = conn.execute("SELECT rating FROM jobs WHERE ticker=? AND status='completed' AND id!=? ORDER BY created DESC LIMIT 1", (job["ticker"], job["id"])).fetchone()
        return row["rating"] if row else None
