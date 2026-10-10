import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  FileText,
  LoaderCircle,
  CircleAlert,
  Clock3,
  ChevronDown,
  X,
  Check,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ratings,
  statuses,
  stages,
  reportSections,
  dateLabel,
  isActive,
  request,
} from "./data.js";

export function Button({ children, busy, className = "", ...props }) {
  return (
    <button
      {...props}
      className={`button ${className}`}
      disabled={busy || props.disabled}
    >
      {busy && <LoaderCircle size={14} className="spin" />}
      {children}
    </button>
  );
}
export function Badge({ rating }) {
  const style = ["Buy", "Overweight"].includes(rating)
    ? "positive"
    : ["Sell", "Underweight"].includes(rating)
      ? "negative"
      : rating === "REVIEW"
        ? "warning"
        : "neutral";
  return (
    <span className={`badge ${style}`}>
      {ratings[rating] || rating || "待分析"}
    </span>
  );
}
export function Status({ job }) {
  return (
    <span className={`job-status ${job.status}`}>
      {job.status === "running" ? (
        <LoaderCircle size={12} className="spin" />
      ) : job.status === "completed" ? (
        <Check size={12} />
      ) : (
        <span className="status-dot" />
      )}
      {statuses[job.status] || job.status}
    </span>
  );
}
export function Empty({ title, children, icon: Icon = FileText }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={26} strokeWidth={1.25} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Markdown({ children }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children || ""}
      </ReactMarkdown>
    </div>
  );
}
export function PageHeading({ eyebrow, title, children, action }) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
      {action}
    </div>
  );
}
export function SubmitForm({ onSubmit, onError, children, className = "" }) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      className={className}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          await onSubmit();
        } catch (err) {
          onError(err.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        {children}
        {busy && (
          <span className="saving-note" role="status">
            正在保存…
          </span>
        )}
      </fieldset>
    </form>
  );
}

export function ResultPanel({ job, ticker, allJobs = [], onPick, onDismiss }) {
  const [detail, setDetail] = useState(null),
    [error, setError] = useState(""),
    [section, setSection] = useState("final_trade_decision");
  const lastId = useRef(null);
  useEffect(() => {
    if (lastId.current !== job?.id) {
      setDetail(null);
      setSection("final_trade_decision");
      lastId.current = job?.id;
    }
    setError("");
    if (!job) return;
    const controller = new AbortController();
    request(`job/${job.id}`, undefined, undefined, controller.signal)
      .then(setDetail)
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, [job?.id, job?.updated, job?.status]);
  const result = detail?.id === job?.id ? detail?.result : null;
  const sections = Object.keys(reportSections).filter(
    (k) => result?.reports?.[k],
  );
  const selected = sections.includes(section) ? section : sections[0];
  const history = allJobs.filter(
    (j) => j.ticker === ticker && j.status !== "cancelled",
  );
  return (
    <section className="card result-card" aria-label="分析结果">
      <div className="card-heading">
        <div>
          <span className="eyebrow">RESEARCH INSIGHTS</span>
          <h2>分析结果</h2>
        </div>
        {onDismiss ? (
          <button
            className="icon-button"
            onClick={onDismiss}
            aria-label="关闭分析详情"
          >
            <X size={18} />
          </button>
        ) : (
          <span className="result-symbol">
            <FileText size={18} />
          </span>
        )}
      </div>
      {!ticker ? (
        <Empty title="从一个标的开始">
          在左侧列表选择股票并点击「分析」，研究结论会呈现在这里。
        </Empty>
      ) : (
        <>
          <div className="result-identity">
            <div className="ticker-avatar large">{ticker.slice(0, 2)}</div>
            <div>
              <h3>{ticker}</h3>
              <p>
                {job
                  ? `${job.trade_date} · ${job.source === "scheduled" ? "定时研究" : "手动研究"}`
                  : "尚未生成研究报告"}
              </p>
            </div>
            <Badge rating={job?.rating} />
          </div>
          {history.length > 1 && (
            <label className="history-select">
              <Clock3 size={14} />
              <select
                aria-label="选择历史分析"
                value={job?.id || ""}
                onChange={(e) => onPick?.(e.target.value)}
              >
                {history.map((j) => (
                  <option key={j.id} value={j.id}>
                    {dateLabel(j.created, true)} ·{" "}
                    {statuses[j.status] || j.status}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </label>
          )}
          {error && (
            <p role="alert" className="error-note">
              {error}
            </p>
          )}
          {!job ? (
            <Empty title="尚无分析结果">
              点击这只股票旁的「分析」，让研究团队开始工作。
            </Empty>
          ) : isActive(job) ? (
            <div className="progress-content">
              <div className="research-orbit">
                <LoaderCircle size={32} className="spin" strokeWidth={1} />
              </div>
              <span className="eyebrow">RESEARCH IN PROGRESS</span>
              <h3>{stages[job.stage] || job.stage}</h3>
              <p>
                正在结合市场资料形成判断。你可以查看其他标的，任务会继续在后台执行。
              </p>
              <div className="workflow">
                <span>资料分析</span>
                <i />
                <span>多空辩论</span>
                <i />
                <span>风控决策</span>
              </div>
            </div>
          ) : job.status === "failed" || job.status === "interrupted" ? (
            <Empty
              icon={CircleAlert}
              title={
                job.status === "failed" ? "这次研究未能完成" : "研究已中断"
              }
            >
              {job.error || "服务重启后任务已中断，请在列表中重新发起分析。"}
            </Empty>
          ) : !result ? (
            <Empty icon={LoaderCircle} title="正在读取报告">
              稍等片刻，正在载入完整研究内容。
            </Empty>
          ) : (
            <>
              <div className="result-context">
                <Check size={13} />
                {detail.settings?.portfolio?.enabled
                  ? "已结合发起时的持仓与成本价"
                  : "基于市场资料 · 未使用个人持仓"}
              </div>
              <div className="report-tabs" role="tablist" aria-label="报告章节">
                {sections.map((k) => (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={selected === k}
                    onClick={() => setSection(k)}
                  >
                    {reportSections[k]}
                  </button>
                ))}
              </div>
              <div className="report-body" role="tabpanel">
                <Markdown>{result.reports[selected]}</Markdown>
              </div>
              <div className="report-footer">
                <span>AI 研究建议，请结合自身情况判断</span>
                {detail.has_report && (
                  <a
                    href={`/api/report/${job.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    完整报告 <ArrowUpRight size={14} />
                  </a>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

export function NotificationPermission({ onError }) {
  const [permission, setPermission] = useState(() =>
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission,
  );
  return (
    <div className="browser-permission">
      <div>
        <h3>浏览器提醒</h3>
        <p>
          {permission === "granted"
            ? "已允许通知。保持页面打开，即可收到新消息。"
            : permission === "denied"
              ? "通知被浏览器阻止，请在网站权限中修改。"
              : permission === "unsupported"
                ? "当前浏览器不支持弹窗通知，消息仍保存在消息中心。"
                : "允许浏览器通知，在有新建议时提醒你。"}
        </p>
      </div>
      <Button
        disabled={["unsupported", "granted"].includes(permission)}
        onClick={async () => {
          try {
            setPermission(await Notification.requestPermission());
          } catch {
            onError("请在浏览器的网站权限中开启通知");
          }
        }}
      >
        {permission === "granted" ? "已开启" : "允许通知"}
      </Button>
    </div>
  );
}
