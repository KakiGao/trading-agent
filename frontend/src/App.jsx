import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Bell,
  LayoutGrid,
  Wallet,
  BrainCircuit,
  Clock3,
  Settings2,
  Plus,
  X,
  Search,
  ChevronRight,
  Check,
  CircleAlert,
  LoaderCircle,
  Activity,
  Layers3,
} from "lucide-react";
import useDashboard from "./useDashboard.js";
import { Button, Badge, Status, Empty, ResultPanel } from "./components.jsx";
import {
  Portfolio,
  Schedule,
  Memory,
  Notifications,
  Preferences,
} from "./views.jsx";
import { dateLabel, tickerList, isActive, stages, request } from "./data.js";

const navigation = [
  ["overview", "研究概览", LayoutGrid],
  ["portfolio", "我的持仓", Wallet],
  ["memory", "决策记忆", BrainCircuit],
  ["schedule", "自动运行", Clock3],
];

export default function App() {
  const [view, setView] = useState("overview"),
    [toast, setToast] = useState(null),
    [selection, setSelection] = useState(null),
    [pinned, setPinned] = useState(null),
    [add, setAdd] = useState(""),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(null);
  const timer = useRef(null);
  const message = useCallback((text, error = false) => {
    setToast({ text, error });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 4500);
  }, []);
  const error = useCallback((text) => message(text, true), [message]);
  const dashboard = useDashboard(message);
  const { state, online, save, run, cancel, mutate, refresh } = dashboard;
  const baseline = useRef(false);
  useEffect(() => {
    if (!state) return;
    try {
      const old = Number(localStorage.getItem("ta-notice-id") || 0),
        latest = state.notifications[0]?.id || 0;
      const fresh = state.notifications.filter((n) => n.id > old);
      localStorage.setItem("ta-notice-id", String(Math.max(old, latest)));
      if (
        baseline.current &&
        fresh.length &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        const n = fresh[0],
          popup = new Notification(
            fresh.length > 1 ? `${fresh.length} 条新的投研消息` : n.title,
            { body: n.body, tag: "tradingagents-update" },
          );
        popup.onclick = () => {
          window.focus();
          setView("notifications");
          popup.close();
        };
      }
      baseline.current = true;
    } catch {
      /* Inbox remains available if browser notifications are unavailable. */
    }
  }, [state?.notifications]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const act = async (callback, key) => {
    if (key) setBusy(key);
    try {
      return await callback();
    } catch (e) {
      error(e.message);
    } finally {
      if (key) setBusy(null);
    }
  };
  const jobs = state?.jobs.filter((j) => j.status !== "cancelled") || [];
  const tickers = state ? tickerList(state.settings) : [];
  const defaultTicker =
    jobs.find((j) => j.status === "completed" && tickers.includes(j.ticker))
      ?.ticker ||
    tickers[0] ||
    null;
  const ticker = selection || defaultTicker;
  const selectedJob =
    (pinned && jobs.find((j) => j.id === pinned && j.ticker === ticker)) ||
    jobs.find((j) => j.ticker === ticker);
  const unread = state?.notifications.filter((n) => !n.seen).length || 0;
  const select = (ticker, id = null) => {
    setSelection(ticker);
    setPinned(id);
    setView("overview");
  };
  const start = (ticker) =>
    act(async () => {
      select(ticker);
      await run(ticker);
    }, `run-${ticker}`);
  const openJob = (id) =>
    act(async () => {
      let job = jobs.find((j) => j.id === id);
      if (!job) job = await request(`job/${id}`);
      if (job.status === "cancelled") {
        message("这项任务已取消");
        return;
      }
      select(job.ticker, id);
    });
  const active = jobs.filter(isActive),
    completed = jobs.filter((j) => j.status === "completed");
  if (!state)
    return (
      <div className="startup">
        <div className="brand-symbol">
          A<span />
        </div>
        <LoaderCircle className="spin" size={23} />
        <h1>{online ? "正在打开研究工作台" : "暂时无法连接本地服务"}</h1>
        <p>
          {online
            ? "载入自选股、持仓与研究记录"
            : "请通过 start-ui.command 启动服务，页面会自动重试。"}
        </p>
      </div>
    );
  return (
    <div className="app-shell">
      <header className="hero">
        <nav className="top-nav" aria-label="主导航">
          <button
            className="brand"
            onClick={() => setView("overview")}
            aria-label="TradingAgents 首页"
          >
            <span className="brand-symbol">
              A<span />
            </span>
            <span>
              TradingAgents<small>YOUR RESEARCH, IN PERSPECTIVE</small>
            </span>
          </button>
          <div className="nav-links">
            {navigation.map(([id, label, Icon]) => (
              <button
                key={id}
                className={view === id ? "active" : ""}
                onClick={() => setView(id)}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
          <div className="nav-actions">
            <button
              className={`nav-icon ${view === "notifications" ? "active" : ""}`}
              aria-label={`消息中心，${unread} 条未读`}
              onClick={() => setView("notifications")}
            >
              <Bell size={18} />
              {unread > 0 && <span className="notification-dot" />}
            </button>
            <button
              className={`nav-icon ${view === "settings" ? "active" : ""}`}
              aria-label="模型与偏好"
              onClick={() => setView("settings")}
            >
              <Settings2 size={18} />
            </button>
            <span className="avatar">K</span>
          </div>
        </nav>
        <div className="hero-content">
          <div>
            <div className="hero-eyebrow">
              <i />
              {online ? "本地研究服务在线" : "服务连接中断"}
            </div>
            <h1>
              看见机会，
              <br className="mobile-break" />
              也看清依据。
            </h1>
            <p>你的 AI 研究团队，与你一起作出更有依据的判断。</p>
            <div className="hero-buttons">
              <Button
                className="light"
                busy={busy === "all"}
                onClick={() =>
                  act(async () => {
                    await run();
                    setView("overview");
                  }, "all")
                }
                disabled={!tickers.length}
              >
                <Plus size={15} />
                分析全部关注
              </Button>
              <button className="hero-link" onClick={() => setView("schedule")}>
                管理运行计划 <ArrowUpRight size={15} />
              </button>
            </div>
          </div>
          <div className="research-pass">
            <div>
              <span>RESEARCH DESK</span>
              <Layers3 size={21} strokeWidth={1} />
            </div>
            <p>独立观点 · 多维研究</p>
            <strong>
              {String(tickers.length).padStart(2, "0")}
              <small>个关注标的</small>
            </strong>
            <div className="pass-bottom">
              <span>
                {state.key_configured ? "DeepSeek 已配置" : "等待模型配置"}
              </span>
              <span>LOCAL / 01</span>
            </div>
          </div>
        </div>
      </header>
      <main className="workspace">
        <div className="workspace-toolbar">
          <div>
            <span>工作台</span>
            <ChevronRight size={12} />
            <strong>
              {navigation.find(([id]) => id === view)?.[1] ||
                { notifications: "消息中心", settings: "模型与偏好" }[view]}
            </strong>
          </div>
          <span>
            <i className={online ? "online-dot" : "offline-dot"} />
            {online ? "已同步" : "等待重连"}
            <b />
            北京时间 {dateLabel(state.today + "T00:00:00+08:00").split(" ")[0]}
          </span>
        </div>
        {!state.key_configured && (
          <div className="setup-banner">
            <CircleAlert size={17} />
            <span>配置 DeepSeek 密钥，让研究团队开始工作。</span>
            <button onClick={() => setView("settings")}>
              前往配置 <ArrowRight size={14} />
            </button>
          </div>
        )}
        {view === "overview" && (
          <>
            <div className="metrics">
              <div>
                <span>
                  <Layers3 size={14} />
                  关注标的
                </span>
                <strong>
                  {tickers.length}
                  <small>只</small>
                </strong>
              </div>
              <div>
                <span>
                  <Activity size={14} />
                  进行中的研究
                </span>
                <strong>
                  {active.length}
                  <small>项</small>
                </strong>
              </div>
              <div>
                <span>
                  <Check size={14} />
                  已完成研究
                </span>
                <strong>
                  {completed.length}
                  <small>份 · 最近 200 条记录</small>
                </strong>
              </div>
              <div>
                <span>
                  <Clock3 size={14} />
                  下次自动分析
                </span>
                <strong className="metric-time">
                  {dateLabel(state.next_due)}
                </strong>
              </div>
            </div>
            <div className="research-layout">
              <section className="card watchlist-card">
                <div className="card-heading">
                  <div>
                    <span className="eyebrow">YOUR WATCHLIST</span>
                    <h2>
                      我的关注 <span className="count">{tickers.length}</span>
                    </h2>
                  </div>
                  <span className="heading-icon">
                    <Layers3 size={18} />
                  </span>
                </div>
                <form
                  className="add-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(async () => {
                      await save({
                        watchlist: [...state.settings.watchlist, add],
                      });
                      setAdd("");
                    }, "add");
                  }}
                >
                  <label className="sr-only" htmlFor="add-ticker">
                    添加股票代码
                  </label>
                  <Plus size={15} />
                  <input
                    id="add-ticker"
                    value={add}
                    onChange={(e) => setAdd(e.target.value)}
                    placeholder="添加标的，如 NVDA / 0700.HK"
                    required
                    maxLength={24}
                  />
                  <Button type="submit" busy={busy === "add"}>
                    添加
                  </Button>
                </form>
                {tickers.length > 6 && (
                  <label className="list-search">
                    <Search size={14} />
                    <input
                      placeholder="搜索关注标的"
                      aria-label="搜索关注标的"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <span>{tickers.length}</span>
                  </label>
                )}
                <div className="list-columns">
                  <span>标的</span>
                  <span>最新建议</span>
                  <span>操作</span>
                </div>
                <div className="watch-rows">
                  {tickers
                    .filter((t) =>
                      t.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((t, index) => {
                      const latest = completed.find((j) => j.ticker === t),
                        working = active.find((j) => j.ticker === t),
                        held =
                          state.settings.portfolio.enabled &&
                          state.settings.portfolio.positions.some(
                            (p) => p.ticker === t,
                          );
                      return (
                        <article
                          key={t}
                          className={`watch-row ${ticker === t ? "selected" : ""}`}
                        >
                          <button
                            className="ticker-select"
                            onClick={() => select(t)}
                            aria-label={`查看 ${t} 分析结果`}
                          >
                            <span className={`ticker-avatar tone-${index % 4}`}>
                              {t.slice(0, 2)}
                            </span>
                            <span>
                              <strong>{t}</strong>
                              <small>
                                {held ? "我的持仓" : "自选观察"}
                                {working
                                  ? " · " +
                                    (working.status === "queued"
                                      ? "排队中"
                                      : "研究中")
                                  : ""}
                              </small>
                            </span>
                          </button>
                          <Badge rating={latest?.rating} />
                          <div className="row-actions">
                            <button
                              className="analyze-button"
                              disabled={Boolean(working) || busy === `run-${t}`}
                              onClick={() => start(t)}
                              aria-label={`分析 ${t}`}
                            >
                              {working ? (
                                <LoaderCircle size={13} className="spin" />
                              ) : (
                                <>
                                  分析 <ArrowUpRight size={13} />
                                </>
                              )}
                            </button>
                            {state.settings.watchlist.includes(t) && (
                              <button
                                className="icon-button remove-watch"
                                aria-label={`移除 ${t}`}
                                onClick={() =>
                                  act(async () => {
                                    await save({
                                      watchlist:
                                        state.settings.watchlist.filter(
                                          (s) => s !== t,
                                        ),
                                    });
                                    if (selection === t) {
                                      setSelection(null);
                                      setPinned(null);
                                    }
                                  })
                                }
                              >
                                <X size={13} />
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  {!tickers.length && (
                    <Empty title="建立你的研究清单">
                      添加你关注的股票，然后直接在列表中开始分析。
                    </Empty>
                  )}
                  {tickers.length > 0 &&
                    !tickers.some((t) =>
                      t.toLowerCase().includes(query.toLowerCase()),
                    ) && <Empty title="没有匹配的标的">试试其他代码。</Empty>}
                </div>
                <div className="watch-footer">
                  <span className="online-dot" />
                  选择标的查看结果，点击「分析」启动新研究。
                </div>
              </section>
              <div className="result-column">
                <ResultPanel
                  job={selectedJob}
                  ticker={ticker}
                  allJobs={jobs}
                  onPick={setPinned}
                />
              </div>
            </div>
            <section className="card activity-card">
              <div className="card-heading">
                <div>
                  <span className="eyebrow">RESEARCH ACTIVITY</span>
                  <h2>研究动态</h2>
                </div>
                <span className="activity-count">{jobs.length} 项研究记录</span>
              </div>
              {jobs.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>标的 / 分析日期</th>
                        <th>状态</th>
                        <th>研究进度</th>
                        <th>建议</th>
                        <th>发起方式</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((j) => (
                        <tr
                          key={j.id}
                          className={
                            selectedJob?.id === j.id ? "selected-job" : ""
                          }
                        >
                          <td>
                            <strong>{j.ticker}</strong>
                            <small>{j.trade_date}</small>
                          </td>
                          <td>
                            <Status job={j} />
                          </td>
                          <td>
                            {stages[j.stage] || j.stage}
                            <small>{dateLabel(j.updated)}</small>
                          </td>
                          <td>
                            <Badge rating={j.rating} />
                          </td>
                          <td>
                            {j.source === "scheduled" ? "自动运行" : "手动分析"}
                          </td>
                          <td>
                            <div className="activity-actions">
                              <button
                                className="text-button"
                                onClick={() => select(j.ticker, j.id)}
                              >
                                查看结果 <ArrowUpRight size={13} />
                              </button>
                              {isActive(j) && (
                                <button
                                  className="cancel-button"
                                  disabled={busy === `cancel-${j.id}`}
                                  onClick={() =>
                                    act(() => cancel(j.id), `cancel-${j.id}`)
                                  }
                                >
                                  取消
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="每份研究，都在这里留下记录">
                  从自选列表点击「分析」开始。取消的任务会自动移除。
                </Empty>
              )}
            </section>
          </>
        )}
        {view === "portfolio" && (
          <Portfolio settings={state.settings} save={save} error={error} />
        )}
        {view === "schedule" && (
          <Schedule
            settings={state.settings}
            nextDue={state.next_due}
            save={save}
            error={error}
          />
        )}
        {view === "memory" && <Memory error={error} />}
        {view === "notifications" && (
          <Notifications
            items={state.notifications}
            onRead={() =>
              act(async () => {
                await mutate("notifications/read", {});
                await refresh();
                message("全部消息已标为已读");
              })
            }
            onOpen={openJob}
            error={error}
          />
        )}
        {view === "settings" && (
          <Preferences
            settings={state.settings}
            keyConfigured={state.key_configured}
            save={save}
            mutate={mutate}
            refresh={refresh}
            message={message}
            error={error}
          />
        )}
        <footer>
          <span className="footer-brand">TradingAgents</span>
          <span>独立研究，有据可循。</span>
          <small>AI 研究建议需自行复核 · 本机存储 · 不执行交易</small>
        </footer>
      </main>
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <CircleAlert size={16} /> : <Check size={16} />}
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} aria-label="关闭提示">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
