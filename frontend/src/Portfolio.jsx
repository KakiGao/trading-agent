import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  Download,
  ArrowUpRight,
  Wallet,
  RefreshCw,
  X,
} from "lucide-react";
import { Button, Empty, SubmitForm, TickerAvatar } from "./components.jsx";
import { dateLabel, request } from "./data.js";

const kinds = {
  buy: "买入",
  sell: "卖出",
  deposit: "入金",
  withdraw: "出金",
  dividend: "分红",
  opening: "期初持仓",
};
const cashKinds = ["deposit", "withdraw", "dividend"];
const localTime = () =>
  new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16);
const initialEntry = () => ({
  id: crypto.randomUUID(),
  kind: "buy",
  occurred_at: localTime(),
  ticker: "",
  quantity: "",
  price: "",
  amount: "",
  fee: "0",
  note: "",
});
const num = (n, digits = 2) =>
  Number(n || 0).toLocaleString("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });

export function PerformanceChart({ series, currency }) {
  const [hover, setHover] = useState(null);
  if (!series.length)
    return (
      <Empty title="记录第一笔交易后生成收益曲线">
        先记录入金或期初持仓，再逐笔添加买卖。
      </Empty>
    );
  const stride = Math.max(1, Math.ceil(series.length / 180));
  const points = series.filter(
    (_, i) => i % stride === 0 || i === series.length - 1,
  );
  const values = points.flatMap((p) => [p.realized, p.profit]);
  const lo = Math.min(0, ...values),
    hi = Math.max(0, ...values),
    pad = Math.max((hi - lo) * 0.12, 1),
    min = lo - pad,
    max = hi + pad;
  const x = (i) => 60 + (i / Math.max(points.length - 1, 1)) * 650,
    y = (v) => 220 - ((v - min) / (max - min)) * 185;
  const line = (key) => points.map((p, i) => `${x(i)},${y(p[key])}`).join(" ");
  const active =
    hover !== null ? points[Math.min(hover, points.length - 1)] : points.at(-1);
  return (
    <div className="performance-chart">
      <div className="chart-legend">
        <span>
          <i className="realized-key" />
          已实现收益 + 分红
        </span>
        <span>
          <i className="profit-key" />
          含估算浮盈亏
        </span>
      </div>
      <svg
        viewBox="0 0 750 255"
        role="img"
        aria-label="交易记录收益曲线"
        onMouseLeave={() => setHover(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((r) => {
          const v = min + r * (max - min);
          return (
            <g key={r}>
              <line
                x1="60"
                x2="710"
                y1={y(v)}
                y2={y(v)}
                className="chart-grid"
              />
              <text x="50" y={y(v) + 4} textAnchor="end" className="chart-axis">
                {num(v, 0)}
              </text>
            </g>
          );
        })}
        <line x1="60" x2="710" y1={y(0)} y2={y(0)} className="chart-zero" />
        <polyline points={line("profit")} className="profit-line" />
        <polyline points={line("realized")} className="realized-line" />
        {points.map((p, i) => (
          <g
            key={p.id}
            tabIndex={0}
            role="button"
            aria-label={`${dateLabel(p.date, true)}，已实现收益及分红 ${num(p.realized)}，含浮盈亏 ${num(p.profit)}`}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            onMouseEnter={() => setHover(i)}
          >
            <circle
              cx={x(i)}
              cy={y(p.realized)}
              r={hover === i ? 5 : 3}
              className="chart-dot"
            />
            <circle
              cx={x(i)}
              cy={y(p.profit)}
              r="3"
              className="chart-dot secondary"
            />
            <rect
              x={x(i) - 10}
              y="25"
              width="20"
              height="200"
              fill="transparent"
            />
            <title>
              {dateLabel(p.date, true)} · {num(p.realized)} {currency}
            </title>
          </g>
        ))}
        <text x="60" y="247" className="chart-axis">
          {dateLabel(points[0].date).slice(0, 5)}
        </text>
        <text x="710" y="247" textAnchor="end" className="chart-axis">
          {dateLabel(points.at(-1).date).slice(0, 5)}
        </text>
      </svg>
      <div className="chart-readout">
        <time>{dateLabel(active.date, true)}</time>
        <span>
          已实现及分红{" "}
          <strong>
            {num(active.realized)} {currency}
          </strong>
        </span>
        <span>
          含浮盈亏{" "}
          <strong>
            {num(active.profit)} {currency}
          </strong>
        </span>
      </div>
    </div>
  );
}

export function AllocationChart({ positions, cash, currency }) {
  const items = [
    ...positions.map((p) => ({ label: p.ticker, value: p.value })),
    { label: "现金", value: cash },
  ]
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = items.reduce((sum, p) => sum + p.value, 0);
  if (!items.length)
    return (
      <Empty icon={Wallet} title="暂无资产分布">
        添加资金和持仓后自动统计。
      </Empty>
    );
  const colors = [
    "#1a73e8",
    "#34a853",
    "#fbbc04",
    "#ea4335",
    "#4285f4",
    "#fdd663",
  ];
  let offset = 0;
  return (
    <div className="allocation-chart">
      <svg
        viewBox="0 0 420 38"
        role="img"
        aria-label="按最后成交价估算的资产分布"
      >
        {items.map((p, i) => {
          const x = offset;
          offset += (p.value / total) * 420;
          return (
            <rect
              key={p.label}
              x={x}
              y="0"
              width={(p.value / total) * 420}
              height="38"
              fill={colors[i % colors.length]}
            >
              <title>
                {p.label} {num((p.value / total) * 100, 1)}%
              </title>
            </rect>
          );
        })}
      </svg>
      <div className="allocation-items">
        {items.map((p, i) => (
          <div key={p.label}>
            <svg width="9" height="9" aria-hidden="true">
              <circle
                cx="4.5"
                cy="4.5"
                r="4.5"
                fill={colors[i % colors.length]}
              />
            </svg>
            <strong>{p.label}</strong>
            <span>{num((p.value / total) * 100, 1)}%</span>
            <small>
              {num(p.value)} {currency}
            </small>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Portfolio({
  settings,
  save,
  mutate,
  refresh,
  message,
  error,
  storage,
}) {
  const [data, setData] = useState(null),
    [entry, setEntry] = useState(initialEntry),
    [pending, setPending] = useState(null),
    [deleting, setDeleting] = useState(false),
    [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState("");
  const [prefs, setPrefs] = useState({
    enabled: settings.portfolio.enabled,
    currency: settings.portfolio.currency,
  });
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("overview");
  const formRef = useRef(null);
  const openLedger = () => {
    setTab("ledger");
    queueMicrotask(() =>
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };
  const load = async () => {
    setLoading(true);
    try {
      setData(await request("portfolio"));
      setLoadError("");
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const update = (key, value) => setEntry((p) => ({ ...p, [key]: value }));
  const cashEntry = cashKinds.includes(entry.kind);
  const add = async () => {
    const payload = {
      ...entry,
      occurred_at: entry.occurred_at + ":00+08:00",
      ticker: cashEntry
        ? entry.kind === "dividend"
          ? entry.ticker || null
          : null
        : entry.ticker,
      quantity: cashEntry ? "0" : entry.quantity,
      price: cashEntry ? "0" : entry.price,
      amount: cashEntry ? entry.amount : "0",
      fee: ["deposit", "withdraw", "opening"].includes(entry.kind)
        ? "0"
        : entry.fee || "0",
    };
    const result = await mutate("portfolio/entries", payload);
    setData(result);
    setEntry(initialEntry());
    await refresh();
    message("记录已保存，持仓和收益已更新");
  };
  const remove = async () => {
    setDeleting(true);
    try {
      const result = await mutate(`portfolio/entries/${pending.id}/delete`, {});
      setData(result);
      setPending(null);
      await refresh();
      message("记录已撤回，持仓、现金和图表已重新计算");
    } catch (e) {
      error(e.message);
    } finally {
      setDeleting(false);
    }
  };
  if (!data)
    return (
      <section className="card">
        <Empty title={loadError ? "账本读取失败" : "正在读取本地账本"}>
          {loadError || "读取持仓、交易日志与收益记录。"}
        </Empty>
        {loadError && <Button onClick={load}>重新载入</Button>}
      </section>
    );
  const s = data.summary,
    currency = data.currency || prefs.currency;
  const entries = data.entries.filter(
    (e) =>
      !query ||
      `${e.ticker || ""} ${kinds[e.kind]} ${e.note}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="portfolio-page">
      <div className="portfolio-toolbar">
        <div className="account-caption">
          <Wallet size={17} />
          <strong>交易账本</strong>
          <span>
            {currency} 账户 · {data.entries.length} 笔记录
          </span>
        </div>
        <div className="portfolio-tabs" role="tablist" aria-label="持仓子页">
          <button
            role="tab"
            aria-selected={tab === "overview"}
            className={tab === "overview" ? "active" : ""}
            onClick={() => setTab("overview")}
          >
            总览
          </button>
          <button
            role="tab"
            aria-selected={tab === "ledger"}
            className={tab === "ledger" ? "active" : ""}
            onClick={() => setTab("ledger")}
          >
            记账
          </button>
        </div>
        <div className="toolbar-actions">
          <a className="button" href="/api/backup" download>
            <Download size={14} />
            导出本地备份
          </a>
          <Button busy={loading} onClick={load} aria-label="刷新账本">
            <RefreshCw size={14} />
          </Button>
          {tab === "overview" && (
            <Button className="primary" onClick={openLedger}>
              <Plus size={14} />
              新增记录
            </Button>
          )}
        </div>
      </div>
      {tab === "overview" ? (
        <>
          <div className="ledger-metrics">
            <article className="card">
              <span>累计已实现收益</span>
              <strong className={s.realized < 0 ? "loss" : "gain"}>
                {num(s.realized)}
              </strong>
              <small>卖出净收入 − 对应持仓成本 · {currency}</small>
            </article>
            <article className="card">
              <span>估算浮动盈亏</span>
              <strong className={s.unrealized < 0 ? "loss" : "gain"}>
                {num(s.unrealized)}
              </strong>
              <small>按各标的最后记录成交价估算</small>
            </article>
            <article className="card">
              <span>账户估算权益</span>
              <strong>{num(s.equity)}</strong>
              <small>
                净投入 {num(s.contributed)} {currency}
              </small>
            </article>
            <article className="card">
              <span>可用现金</span>
              <strong>{num(s.cash)}</strong>
              <small>
                分红净额 {num(s.dividends)} · 手续费 {num(s.fees)}
              </small>
            </article>
          </div>
          <div className="ledger-charts">
            <section className="card">
              <div className="card-heading">
                <h2>收益走势</h2>
                <span className="muted">{currency} · 按交易顺序</span>
              </div>
              <PerformanceChart series={data.series} currency={currency} />
              <p className="chart-footnote">
                入出金不计入收益。浮盈亏采用最后记录的成交价，不是实时行情；历史点仅在有记录时变化。
              </p>
            </section>
            <section className="card">
              <div className="card-heading">
                <h2>资产分布</h2>
                <span className="muted">成交价估算</span>
              </div>
              <AllocationChart
                positions={data.positions}
                cash={s.cash}
                currency={currency}
              />
            </section>
          </div>
          <section className="card ledger-holdings">
            <div className="card-heading">
              <h2>当前持仓</h2>
              <span className="muted">移动加权平均成本 · 包含买入手续费</span>
            </div>
            {data.positions.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>标的</th>
                      <th>数量</th>
                      <th>平均成本</th>
                      <th>记录价格 / 时间</th>
                      <th>估算市值</th>
                      <th>估算浮盈亏</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.positions.map((p) => (
                      <tr key={p.ticker}>
                        <td>
                          <div className="holding-ticker">
                            <TickerAvatar ticker={p.ticker} />
                            <strong>{p.ticker}</strong>
                          </div>
                        </td>
                        <td>{num(p.quantity, 6)}</td>
                        <td>{num(p.average_price, 4)}</td>
                        <td>
                          {num(p.last_price, 4)}
                          <small>{dateLabel(p.price_date, true)}</small>
                        </td>
                        <td>{num(p.value)}</td>
                        <td className={p.unrealized < 0 ? "loss" : "gain"}>
                          {num(p.unrealized)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="目前没有持仓">
                新建买入记录，或用「期初持仓」录入已有股票。
              </Empty>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="ledger-input-layout">
            <section className="card form-card" ref={formRef}>
              <div className="card-heading">
                <h2>新增记录</h2>
                <span className="muted">{currency}</span>
              </div>
              <SubmitForm onSubmit={add} onError={error}>
                <div className="form-grid">
                  <label>
                    记录类型
                    <select
                      value={entry.kind}
                      onChange={(e) => update("kind", e.target.value)}
                    >
                      {Object.entries(kinds).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    发生时间 · 北京时间
                    <input
                      type="datetime-local"
                      required
                      value={entry.occurred_at}
                      onChange={(e) => update("occurred_at", e.target.value)}
                    />
                  </label>
                </div>
                {(!cashEntry || entry.kind === "dividend") && (
                  <label>
                    股票代码{entry.kind === "dividend" ? "（可选）" : ""}
                    <input
                      required={!cashEntry}
                      value={entry.ticker}
                      placeholder="例如 NVDA / 0700.HK"
                      maxLength={24}
                      onChange={(e) => update("ticker", e.target.value)}
                    />
                  </label>
                )}
                <div className="form-grid">
                  {cashEntry ? (
                    <label>
                      金额
                      <input
                        type="number"
                        min="0.00000001"
                        step="any"
                        required
                        value={entry.amount}
                        onChange={(e) => update("amount", e.target.value)}
                      />
                    </label>
                  ) : (
                    <>
                      <label>
                        成交数量
                        <input
                          type="number"
                          min="0.00000001"
                          step="any"
                          required
                          value={entry.quantity}
                          onChange={(e) => update("quantity", e.target.value)}
                        />
                      </label>
                      <label>
                        {entry.kind === "opening" ? "期初均价" : "成交单价"}
                        <input
                          type="number"
                          min={entry.kind === "opening" ? "0" : "0.00000001"}
                          step="any"
                          required
                          value={entry.price}
                          onChange={(e) => update("price", e.target.value)}
                        />
                      </label>
                    </>
                  )}
                  {!["deposit", "withdraw", "opening"].includes(entry.kind) && (
                    <label>
                      手续费
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={entry.fee}
                        onChange={(e) => update("fee", e.target.value)}
                      />
                    </label>
                  )}
                </div>
                <label>
                  备注
                  <input
                    value={entry.note}
                    maxLength={500}
                    placeholder="交易理由、复盘笔记（选填）"
                    onChange={(e) => update("note", e.target.value)}
                  />
                </label>
                <p className="hint">
                  {entry.kind === "opening"
                    ? "期初持仓不扣现金，成本计入初始投入；不包含录入前的收益。"
                    : "现金不足时请先补录入金；补录历史记录后会重新计算其后的全部持仓。"}
                </p>
                <Button type="submit" className="primary">
                  保存记录 <ArrowUpRight size={14} />
                </Button>
              </SubmitForm>
            </section>
            <section className="card form-card">
              <div className="card-heading">
                <h2>账户与本地存储</h2>
              </div>
              <SubmitForm
                onSubmit={async () => {
                  await save({ portfolio: { ...settings.portfolio, ...prefs } });
                  await load();
                }}
                onError={error}
              >
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={prefs.enabled}
                    onChange={(e) =>
                      setPrefs({ ...prefs, enabled: e.target.checked })
                    }
                  />
                  <span>研究时使用当前持仓与成本</span>
                </label>
                <label>
                  账户币种
                  <select
                    disabled={data.entries.length > 0}
                    value={prefs.currency}
                    onChange={(e) =>
                      setPrefs({ ...prefs, currency: e.target.value })
                    }
                  >
                    {["USD", "HKD", "CNY", "JPY", "EUR", "GBP"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <p className="hint">
                  一个账本使用一种报价币种，不自动换汇。保存后，新研究会使用日志计算出的现金和持仓，并发送给所选模型服务。
                </p>
                <Button type="submit">保存账户设置</Button>
              </SubmitForm>
              <div className="local-storage-note">
                <strong>已持久化保存在本机</strong>
                <p>
                  每次保存即写入磁盘。刷新、关闭浏览器或重启不会清空；删除日志会撤回该笔操作并重新计算。
                </p>
                <code>
                  {storage?.database ||
                    "~/.tradingagents/dashboard/dashboard.db"}
                </code>
                <p>
                  本机文件被删除或磁盘损坏仍可能丢失，请定期导出备份。备份包含账户与研究记录，不包含
                  API 密钥。
                </p>
              </div>
            </section>
          </div>
          <section className="card journal-card">
            <div className="card-heading">
              <h2>
                交易日志 <span className="count">{data.entries.length}</span>
              </h2>
              <input
                className="journal-search"
                aria-label="搜索交易日志"
                placeholder="搜索标的、类型或备注"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {entries.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>时间 / 类型</th>
                      <th>标的</th>
                      <th>数量 / 单价</th>
                      <th>金额 / 手续费</th>
                      <th>本笔已实现收益</th>
                      <th>备注</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <strong>{kinds[e.kind]}</strong>
                          <small>{dateLabel(e.occurred_at, true)}</small>
                        </td>
                        <td>{e.ticker || "—"}</td>
                        <td>
                          {cashKinds.includes(e.kind) ? (
                            "—"
                          ) : (
                            <>
                              {num(e.quantity, 4)}
                              <small>@ {num(e.price, 4)}</small>
                            </>
                          )}
                        </td>
                        <td>
                          {num(
                            cashKinds.includes(e.kind)
                              ? e.amount
                              : Number(e.quantity) * Number(e.price),
                          )}
                          <small>费用 {num(e.fee)}</small>
                        </td>
                        <td>{e.kind === "sell" ? num(e.realized) : "—"}</td>
                        <td className="journal-note">{e.note || "—"}</td>
                        <td>
                          <button
                            className="text-button danger"
                            onClick={() => setPending(e)}
                            aria-label={`删除 ${kinds[e.kind]} ${e.ticker || ""} ${dateLabel(e.occurred_at, true)}`}
                          >
                            <Trash2 size={13} />
                            删除并撤回
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title={query ? "没有匹配的记录" : "尚无交易日志"}>
                每次买卖会在这里留下一笔可撤回的记录。
              </Empty>
            )}
          </section>
        </>
      )}
      {pending && (
        <div className="dialog-overlay">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
          >
            <button
              className="icon-button dialog-close"
              onClick={() => !deleting && setPending(null)}
              aria-label="关闭撤回确认"
            >
              <X size={17} />
            </button>
            <h2 id="delete-title">撤回这笔{kinds[pending.kind]}记录？</h2>
            <p>
              {pending.ticker || currency} ·{" "}
              {dateLabel(pending.occurred_at, true)}
            </p>
            <p>
              删除后会重新计算现金、持仓成本和收益图表。如果后续卖出或资金支出依赖此记录，需要先撤回那些记录。
            </p>
            <div className="dialog-actions">
              <Button onClick={() => setPending(null)} disabled={deleting}>
                保留记录
              </Button>
              <Button className="primary" busy={deleting} onClick={remove}>
                确认撤回
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
