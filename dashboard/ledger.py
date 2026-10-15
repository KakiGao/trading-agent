"""A replayable local transaction ledger; cost basis uses moving averages.

Amounts are calculated with Decimal. Valuations use recorded execution prices,
never invented live quotes. Entry mutation and materialized holdings commit in
the same SQLite transaction. Deleted entries remain as rollback tombstones.
"""
from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, field_validator, model_validator

from dashboard.core import Book, Settings, TZ, now, symbol

ET = ZoneInfo("America/New_York")


class Entry(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex, pattern=r"^[a-zA-Z0-9-]{16,64}$")
    kind: Literal["buy", "sell", "deposit", "withdraw", "dividend", "opening"]
    occurred_at: datetime
    ticker: str | None = None
    quantity: Decimal = Field(default=Decimal(0), ge=0, le=10**12, allow_inf_nan=False, decimal_places=8)
    price: Decimal = Field(default=Decimal(0), ge=0, le=10**12, allow_inf_nan=False, decimal_places=8)
    amount: Decimal = Field(default=Decimal(0), ge=0, le=10**15, allow_inf_nan=False, decimal_places=8)
    fee: Decimal = Field(default=Decimal(0), ge=0, le=10**12, allow_inf_nan=False, decimal_places=8)
    note: str = Field(default="", max_length=500)

    @field_validator("ticker")
    @classmethod
    def valid_ticker(cls, value):
        return symbol(value) if value else None

    @field_validator("occurred_at")
    @classmethod
    def valid_time(cls, value):
        # Naive timestamps are US Eastern calendar dates (date-only UI).
        value = (
            datetime(value.year, value.month, value.day, tzinfo=ET)
            if value.tzinfo is None
            else value.astimezone(ET)
        )
        if value.date() > datetime.now(ET).date():
            raise ValueError("不能记录未来的交易")
        return value.astimezone(TZ)

    @model_validator(mode="after")
    def valid_entry(self):
        if self.kind in ("buy", "sell", "opening"):
            if not self.ticker or self.quantity <= 0 or (self.price <= 0 and self.kind != "opening"):
                raise ValueError("买卖记录需要股票代码、正数数量和成交价")
            if self.amount:
                raise ValueError("买卖金额由数量和成交价计算")
        elif self.amount <= 0 or self.quantity or self.price:
            raise ValueError("资金记录需要正数金额，不填写数量和成交价")
        if self.kind in ("deposit", "withdraw", "opening") and self.fee:
            raise ValueError("入出金及期初持仓不填写手续费")
        return self


def number(value):
    return float(round(value, 8))


def replay(rows):
    cash = contributed = realized = dividends = fees = Decimal(0)
    positions, marks, series, journal, by_symbol = {}, {}, [], [], {}
    wins = losses = 0
    for row in rows:
        e = Entry.model_validate_json(row["body"])
        t, q, p, f, a = e.ticker, e.quantity, e.price, e.fee, e.amount
        pnl = Decimal(0)
        pos = positions.setdefault(t, {"quantity": Decimal(0), "cost": Decimal(0)}) if t else None
        if e.kind in ("buy", "opening"):
            cost = q * p + f
            if e.kind == "buy":
                cash -= cost
            else:
                contributed += cost
            pos["quantity"] += q
            pos["cost"] += cost
            marks[t] = (p, e.occurred_at.isoformat())
        elif e.kind == "sell":
            if pos["quantity"] < q:
                raise ValueError(f"{t} 在 {e.occurred_at:%Y-%m-%d %H:%M} 的卖出数量超过当时持仓；请先撤回依赖它的卖出记录")
            cost = pos["cost"] * q / pos["quantity"]
            pnl = q * p - f - cost
            pos["quantity"] -= q
            pos["cost"] -= cost
            cash += q * p - f
            realized += pnl
            by_symbol[t] = by_symbol.get(t, Decimal(0)) + pnl
            wins += int(pnl > 0)
            losses += int(pnl < 0)
            marks[t] = (p, e.occurred_at.isoformat())
        elif e.kind == "deposit":
            cash += a
            contributed += a
        elif e.kind == "withdraw":
            cash -= a
            contributed -= a
        elif e.kind == "dividend":
            cash += a - f
            dividends += a - f
        fees += f
        if cash < Decimal('-0.00000001'):
            raise ValueError(f"{e.occurred_at:%Y-%m-%d %H:%M} 后现金不足；请先补录入金，或撤回依赖这笔资金的后续记录")
        cash = max(cash, Decimal(0))
        market = sum((v["quantity"] * marks[k][0] for k, v in positions.items() if v["quantity"]), Decimal(0))
        basis = sum((v["cost"] for v in positions.values()), Decimal(0))
        series.append({"id": e.id, "date": e.occurred_at.isoformat(), "cash": number(cash), "equity": number(cash + market), "contributed": number(contributed), "realized": number(realized + dividends), "profit": number(realized + dividends + market - basis)})
        journal.append({**json.loads(e.model_dump_json()), "realized": number(pnl), "cash_after": number(cash), "created": row["created"]})
    holdings = [{"ticker": t, "quantity": number(v["quantity"]), "average_price": number(v["cost"] / v["quantity"]), "cost": number(v["cost"]), "last_price": number(marks[t][0]), "price_date": marks[t][1], "value": number(v["quantity"] * marks[t][0]), "unrealized": number(v["quantity"] * marks[t][0] - v["cost"])} for t, v in positions.items() if v["quantity"] > 0]
    unrealized = sum((Decimal(str(p["unrealized"])) for p in holdings), Decimal(0))
    equity = cash + sum((Decimal(str(p["value"])) for p in holdings), Decimal(0))
    return {"entries": list(reversed(journal)), "positions": holdings, "series": series, "by_symbol": [{"ticker": t, "realized": number(v)} for t, v in by_symbol.items()], "summary": {"cash": number(cash), "equity": number(equity), "contributed": number(contributed), "realized": number(realized), "dividends": number(dividends), "unrealized": number(unrealized), "profit": number(realized + dividends + unrealized), "fees": number(fees), "wins": wins, "losses": losses}}


def rows(conn):
    return conn.execute("SELECT * FROM ledger_entries WHERE deleted_at IS NULL ORDER BY occurred_at,seq").fetchall()


def insert(conn, entry):
    conn.execute("INSERT INTO ledger_entries(id,occurred_at,body,created) VALUES(?,?,?,?)", (entry.id, entry.occurred_at.isoformat(), entry.model_dump_json(), now().isoformat()))


def initialize(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS ledger_entries (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
          occurred_at TEXT NOT NULL, body TEXT NOT NULL, created TEXT NOT NULL, deleted_at TEXT);
        CREATE TABLE IF NOT EXISTS ledger_meta (id INTEGER PRIMARY KEY, version INTEGER NOT NULL);
    """)
    if conn.execute("SELECT 1 FROM ledger_meta WHERE id=1").fetchone():
        return
    # One-time migration: preserve the previous account as explicit opening logs.
    settings = Settings.model_validate_json(conn.execute("SELECT body FROM config WHERE id=1").fetchone()[0])
    at = now()
    if settings.portfolio.cash:
        insert(conn, Entry(kind="deposit", occurred_at=at, amount=str(settings.portfolio.cash), note="从原账户迁移的期初现金"))
    for position in settings.portfolio.positions:
        insert(conn, Entry(kind="opening", occurred_at=at, ticker=position.ticker, quantity=str(position.quantity), price=str(position.average_price), note="从原账户迁移的期初持仓；不包含迁移前的历史收益"))
    conn.execute("INSERT INTO ledger_meta VALUES(1,1)")


def materialize(conn, data):
    settings = Settings.model_validate_json(conn.execute("SELECT body FROM config WHERE id=1").fetchone()[0])
    settings.portfolio = Book(enabled=settings.portfolio.enabled, currency=settings.portfolio.currency, cash=data["summary"]["cash"], positions=[{k: p[k] for k in ("ticker", "quantity", "average_price")} for p in data["positions"]])
    conn.execute("UPDATE config SET body=? WHERE id=1", (settings.model_dump_json(),))


def mutate(store, entry=None, delete_id=None):
    with store.lock, store.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if entry:
            old = conn.execute("SELECT body,deleted_at FROM ledger_entries WHERE id=?", (entry.id,)).fetchone()
            if old:
                if old["deleted_at"] or old["body"] != entry.model_dump_json():
                    raise ValueError("此记录编号已使用，请刷新页面后重新提交")
            else:
                insert(conn, entry)
        if delete_id:
            if not conn.execute("UPDATE ledger_entries SET deleted_at=? WHERE id=? AND deleted_at IS NULL", (now().isoformat(), delete_id)).rowcount:
                raise ValueError("记录已删除或不存在")
        data = replay(rows(conn))
        materialize(conn, data)
        return data


def sector_buckets(positions, cash):
    """Group holding market value by Yahoo sector; ETFs without sector → ETF / 基金."""
    from tradingagents.agents.context import resolve_instrument_identity

    buckets: dict[str, Decimal] = {}
    for p in positions:
        ident = resolve_instrument_identity(p["ticker"])
        qt = (ident.get("quote_type") or "").upper()
        sector = ident.get("sector")
        if not sector:
            if qt in ("ETF", "MUTUALFUND"):
                sector = "ETF / 基金"
            elif qt == "CRYPTOCURRENCY":
                sector = "加密货币"
            else:
                sector = "未分类"
        buckets[sector] = buckets.get(sector, Decimal(0)) + Decimal(str(p["value"]))
    if Decimal(str(cash or 0)) > 0:
        buckets["现金"] = buckets.get("现金", Decimal(0)) + Decimal(str(cash))
    return [
        {"sector": name, "value": number(value)}
        for name, value in sorted(buckets.items(), key=lambda kv: kv[1], reverse=True)
        if value > 0
    ]


def snapshot(store):
    with store.lock, store.connect() as conn:
        data = replay(rows(conn))
        book = Settings.model_validate_json(conn.execute("SELECT body FROM config WHERE id=1").fetchone()[0]).portfolio
        return {
            **data,
            "by_sector": sector_buckets(data["positions"], data["summary"]["cash"]),
            "currency": book.currency,
            "enabled": book.enabled,
        }
