export const ratings = {
  Buy: "买入",
  Overweight: "加仓",
  Hold: "持有",
  Underweight: "减仓",
  Sell: "卖出",
  REVIEW: "待复核",
};
export const statuses = {
  queued: "等待分析",
  running: "分析中",
  completed: "已完成",
  failed: "未完成",
  interrupted: "已中断",
};
export const stages = {
  "Market Analyst": "技术分析",
  "Sentiment Analyst": "市场情绪",
  "News Analyst": "新闻与宏观",
  "Fundamentals Analyst": "基本面分析",
  "Memory Log": "历史决策复盘",
  "Bull Researcher": "多方研究",
  "Bear Researcher": "空方研究",
  "Research Manager": "汇总研究",
  Trader: "制定方案",
  "Aggressive Analyst": "进取风控",
  "Conservative Analyst": "保守风控",
  "Neutral Analyst": "中性风控",
  "Portfolio Manager": "最终决策",
};
export const reportSections = {
  final_trade_decision: "最终决策",
  trader_investment_plan: "交易方案",
  investment_plan: "研究计划",
  market_report: "技术分析",
  fundamentals_report: "基本面分析",
  news_report: "新闻与宏观",
  sentiment_report: "市场情绪",
  memory_note: "记忆状态",
};
export const analystOptions = [
  ["market", "技术分析", "趋势、动量与价格结构"],
  ["fundamentals", "基本面", "财报、现金流与公司价值"],
  ["news", "新闻与宏观", "事件、政策与市场变化"],
  ["social", "市场情绪", "新闻与社交讨论的观点"],
];
export const isActive = (job) => ["queued", "running"].includes(job?.status);
export const dateLabel = (date, full = false) =>
  date
    ? new Date(date).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        ...(full ? { year: "numeric" } : {}),
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "未开启";
export const tickerList = (settings) => [
  ...new Set([
    ...settings.watchlist,
    ...(settings.portfolio.enabled
      ? settings.portfolio.positions.map((p) => p.ticker)
      : []),
  ]),
];

/** YYYY-MM-DD minus daysBack in calendar days (UTC date arithmetic). */
export function dayOffset(isoDay, daysBack) {
  const [y, m, d] = isoDay.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - daysBack);
  return dt.toISOString().slice(0, 10);
}

/** Filter research activity by trade_date; active jobs always stay visible. */
export function filterActivityJobs(jobs, { preset = "7", from = "", to = "", today }) {
  if (!today) return jobs;
  let start = from,
    end = to;
  if (preset !== "custom") {
    if (preset === "all") return jobs;
    const days = Number(preset);
    end = today;
    start = dayOffset(today, Math.max(0, days - 1));
  }
  return jobs.filter((job) => {
    if (isActive(job)) return true;
    const day = String(job.trade_date || job.created || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return true;
    if (start && day < start) return false;
    if (end && day > end) return false;
    return true;
  });
}

export async function request(path, data, token, signal) {
  const response = await fetch(`/api/${path}`, {
    signal,
    ...(data === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Dashboard-Token": token || "",
          },
          body: JSON.stringify(data),
        }),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      Array.isArray(body.detail)
        ? body.detail.map((e) => e.msg).join("；")
        : body.detail || "请求未完成，请重试",
    );
  return body;
}
