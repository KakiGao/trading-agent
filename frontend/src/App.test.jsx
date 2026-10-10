import { describe, it, expect, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";
import { Markdown, Button } from "./components.jsx";

const job = {
  id: "completed-1",
  ticker: "AAPL",
  trade_date: "2026-10-09",
  created: "2026-10-09T08:00:00Z",
  updated: "2026-10-09T08:10:00Z",
  source: "manual",
  status: "completed",
  rating: "Hold",
  stage: "Portfolio Manager",
};
function mockServer(extraJobs = []) {
  const state = {
    csrf: "test-token",
    key_configured: true,
    today: "2026-10-10",
    next_due: null,
    notifications: [],
    jobs: [...extraJobs, job],
    settings: {
      watchlist: ["AAPL", "NVDA"],
      portfolio: { enabled: false, cash: 0, currency: "USD", positions: [] },
      analysts: ["market", "news"],
      schedule_enabled: false,
      schedule_mode: "daily",
      daily_time: "16:30",
      interval_minutes: 60,
      weekdays_only: true,
      notify_mode: "changes",
    },
  };
  const fetch = vi.fn(async (url, options = {}) => {
    const path = url.replace("/api/", "");
    let body = {};
    if (path === "state") body = structuredClone(state);
    else if (path.startsWith("job/"))
      body = {
        ...state.jobs.find((j) => j.id === path.slice(4)),
        settings: state.settings,
        result: {
          reports: {
            final_trade_decision: "## 投资结论\n保持现有仓位，等待进一步确认。",
            market_report: "趋势仍需观察。",
          },
        },
        has_report: true,
      };
    else if (path === "run") {
      const { ticker } = JSON.parse(options.body);
      state.jobs.unshift({
        ...job,
        id: "new-job",
        ticker,
        status: "queued",
        rating: null,
        stage: "等待分析",
      });
      body = { ids: ["new-job"], message: "已加入研究队列" };
    } else if (path.startsWith("cancel/")) {
      // Simulate a stale state response: the cancelled job must stay hidden.
      body = { ok: true };
    } else if (path === "settings") {
      state.settings = JSON.parse(options.body);
      body = state.settings;
    } else throw new Error(`Unexpected request ${path}`);
    return { ok: true, json: async () => body };
  });
  vi.stubGlobal("fetch", fetch);
  return { state, fetch };
}

describe("research workspace", () => {
  it("shows an existing report at the right, with chapter switching and no standalone analysis form", async () => {
    mockServer();
    render(<App />);
    const result = await screen.findByRole("region", { name: "分析结果" });
    expect(await within(result).findByText("投资结论")).toBeVisible();
    expect(screen.queryByText("开始一次独立研究")).not.toBeInTheDocument();
    expect(document.querySelector("input[type=date]")).toBeNull();
    await userEvent.click(
      within(result).getByRole("tab", { name: "技术分析" }),
    );
    expect(within(result).getByText("趋势仍需观察。")).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "查看 NVDA 分析结果" }),
    );
    expect(within(result).getByText("尚无分析结果")).toBeVisible();
    expect(within(result).queryByText("投资结论")).not.toBeInTheDocument();
  });
  it("runs the ticker directly from its list button and shows progress", async () => {
    const { fetch } = mockServer();
    render(<App />);
    await userEvent.click(
      await screen.findByRole("button", { name: "分析 NVDA" }),
    );
    await screen.findByText("已加入研究队列");
    const call = fetch.mock.calls.find(([url]) => url === "/api/run");
    expect(JSON.parse(call[1].body)).toEqual({ ticker: "NVDA" });
    expect(call[1].headers["X-Dashboard-Token"]).toBe("test-token");
    expect(screen.getByRole("button", { name: "分析 NVDA" })).toBeDisabled();
    expect(
      within(screen.getByRole("region", { name: "分析结果" })).getByText(
        "RESEARCH IN PROGRESS",
      ),
    ).toBeVisible();
  });
  it("hides cancelled jobs and removes a newly cancelled task despite a stale poll", async () => {
    const { fetch } = mockServer([
      { ...job, id: "cancelled-old", ticker: "OLD", status: "cancelled" },
      {
        ...job,
        id: "running-1",
        ticker: "NVDA",
        status: "running",
        rating: null,
      },
    ]);
    render(<App />);
    const cancel = await screen.findByRole("button", { name: "取消" });
    expect(screen.queryByText("OLD")).not.toBeInTheDocument();
    await userEvent.click(cancel);
    await screen.findByText("任务已取消，并从研究动态移除");
    expect(
      screen.queryByRole("button", { name: "取消" }),
    ).not.toBeInTheDocument();
    expect(
      fetch.mock.calls.some(([url]) => url === "/api/cancel/running-1"),
    ).toBe(true);
    expect(
      within(screen.getByRole("table")).queryByText("NVDA"),
    ).not.toBeInTheDocument();
  });
  it("persists a new watchlist entry while retaining portfolio and schedule settings", async () => {
    const { state, fetch } = mockServer();
    render(<App />);
    await userEvent.type(await screen.findByLabelText("添加股票代码"), "AMD");
    await userEvent.click(
      screen.getByRole("button", { name: "添加", exact: true }),
    );
    await waitFor(() =>
      expect(state.settings.watchlist).toEqual(["AAPL", "NVDA", "AMD"]),
    );
    expect(state.settings.schedule_mode).toBe("daily");
    expect(state.settings.portfolio.currency).toBe("USD");
    expect(fetch.mock.calls.some(([url]) => url === "/api/settings")).toBe(
      true,
    );
  });
  it("keeps untrusted report HTML and unsafe links inert", () => {
    const { container } = render(
      <Markdown>
        {
          "<script>alert(1)</script>\n\n[unsafe](javascript:alert%281%29)\n\n**正常报告**"
        }
      </Markdown>,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).not.toMatch(
      /^javascript:/,
    );
    expect(screen.getByText("正常报告")).toBeVisible();
  });
  it("disables a busy action even if its normal disabled state is false", () => {
    render(
      <Button busy disabled={false}>
        保存
      </Button>,
    );
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });
});
