import { it, expect, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Portfolio, { PerformanceChart, AllocationChart } from "./Portfolio.jsx";
import ModelConfiguration from "./ModelConfiguration.jsx";
const empty = {
  currency: "USD",
  enabled: false,
  entries: [],
  positions: [],
  series: [],
  summary: {
    cash: 0,
    contributed: 0,
    equity: 0,
    realized: 0,
    unrealized: 0,
    profit: 0,
    fees: 0,
    dividends: 0,
  },
};
const deposit = {
  id: "deposit-entry-1",
  kind: "deposit",
  occurred_at: "2026-01-01T09:00:00+08:00",
  amount: "1000",
  fee: "0",
  note: "测试入金",
};
const funded = {
  ...empty,
  entries: [deposit],
  summary: { ...empty.summary, cash: 1000, equity: 1000, contributed: 1000 },
  series: [
    { id: deposit.id, date: deposit.occurred_at, realized: 0, profit: 0 },
  ],
};
const settings = {
  portfolio: { enabled: false, cash: 0, currency: "USD", positions: [] },
  models: {
    provider: "deepseek",
    fluxport_base_url: "https://api.uselg.top/v1",
    fluxport_model: "gpt-6-sol",
  },
};
function renderLedger(data = empty) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => structuredClone(data) })),
  );
  const mutate = vi.fn(async (path) =>
      path.endsWith("/delete") ? empty : funded,
    ),
    error = vi.fn(),
    refresh = vi.fn(async () => {}),
    message = vi.fn();
  render(
    <Portfolio
      settings={settings}
      mutate={mutate}
      refresh={refresh}
      save={vi.fn()}
      message={message}
      error={error}
    />,
  );
  return { mutate, error, message };
}
async function openLedgerTab() {
  await userEvent.click(await screen.findByRole("tab", { name: "记账" }));
}
it("records a cash deposit and immediately displays its journal and chart", async () => {
  const { mutate } = renderLedger();
  await openLedgerTab();
  await userEvent.selectOptions(
    await screen.findByLabelText("记录类型"),
    "deposit",
  );
  await userEvent.type(screen.getByLabelText("金额"), "1000");
  await userEvent.click(screen.getByRole("button", { name: "保存记录" }));
  const payload = mutate.mock.calls[0][1];
  expect(payload.kind).toBe("deposit");
  expect(payload.amount).toBe("1000");
  expect(payload.quantity).toBe("0");
  expect(payload.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00$/);
  expect(await screen.findByText("测试入金")).toBeVisible();
  await userEvent.click(screen.getByRole("tab", { name: "总览" }));
  await screen.findByRole("img", { name: "交易记录收益曲线" });
});
it("confirms withdrawal of a journal entry and removes its financial effect", async () => {
  const { mutate } = renderLedger(funded);
  await openLedgerTab();
  await userEvent.click(
    await screen.findByRole("button", { name: /删除 入金/ }),
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  await userEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "确认撤回",
    }),
  );
  await waitFor(() =>
    expect(screen.queryByText("测试入金")).not.toBeInTheDocument(),
  );
  expect(mutate).toHaveBeenCalledWith(
    "portfolio/entries/deposit-entry-1/delete",
    {},
  );
  await userEvent.click(screen.getByRole("tab", { name: "总览" }));
  expect(
    screen.queryByRole("img", { name: "交易记录收益曲线" }),
  ).not.toBeInTheDocument();
});
it("keeps the ledger visible if dependent transactions prevent deletion", async () => {
  const { mutate, error } = renderLedger(funded);
  mutate.mockRejectedValue(new Error("后续支出依赖此记录"));
  await openLedgerTab();
  await userEvent.click(
    await screen.findByRole("button", { name: /删除 入金/ }),
  );
  await userEvent.click(screen.getByRole("button", { name: "确认撤回" }));
  await waitFor(() => expect(error).toHaveBeenCalledWith("后续支出依赖此记录"));
  expect(screen.getByText("测试入金")).toBeVisible();
});
it("renders negative P&L and allocations with accessible data points", () => {
  render(
    <>
      <PerformanceChart
        currency="USD"
        series={[
          { id: "1", date: "2026-01-01T00:00:00Z", realized: 0, profit: -10 },
          { id: "2", date: "2026-01-02T00:00:00Z", realized: -50, profit: -30 },
        ]}
      />
      <AllocationChart
        currency="USD"
        cash={500}
        positions={[{ ticker: "AMD", value: 500 }]}
      />
    </>,
  );
  expect(screen.getByRole("img", { name: "交易记录收益曲线" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: /已实现收益及分红 -50.00/ }),
  ).toBeInTheDocument();
  expect(screen.getByText("AMD")).toBeVisible();
  expect(screen.getAllByText("50.0%")).toHaveLength(2);
});
it("saves Fluxport credentials separately and applies the chosen model", async () => {
  const save = vi.fn(async () => {}),
    mutate = vi.fn(async () => {});
  const refresh = vi.fn(async () => {});
  const { rerender } = render(
    <ModelConfiguration
      settings={settings}
      providerKeys={{ deepseek: true, fluxport: false }}
      providerKeyMasks={{ deepseek: "sk-t•••••••••••••••••••••••••••••••key", fluxport: null }}
      save={save}
      mutate={mutate}
      refresh={refresh}
      message={vi.fn()}
      error={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole("radio", { name: /Fluxport/ }));
  expect(screen.getByLabelText("模型")).toHaveValue("gpt-6-sol");
  await userEvent.type(
    screen.getByLabelText("Fluxport LLM API Key"),
    "test-only-key",
  );
  await userEvent.click(screen.getByRole("button", { name: "保存模型配置" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      models: {
        provider: "fluxport",
        fluxport_model: "gpt-6-sol",
        fluxport_base_url: "https://api.uselg.top/v1",
        grsai_model: "gemini-3.1-pro",
        grsai_base_url: "https://grsaiapi.com/v1",
      },
    }),
  );
  expect(mutate).toHaveBeenCalledWith("key", {
    provider: "fluxport",
    key: "test-only-key",
  });
  rerender(
    <ModelConfiguration
      settings={{
        ...settings,
        models: {
          provider: "fluxport",
          fluxport_model: "gpt-6-sol",
          fluxport_base_url: "https://api.uselg.top/v1",
        },
      }}
      providerKeys={{ deepseek: true, fluxport: true }}
      providerKeyMasks={{
        deepseek: "sk-t•••••••••••••••••••••••••••••••key",
        fluxport: "test•••••••••••••••-key",
      }}
      save={save}
      mutate={mutate}
      refresh={refresh}
      message={vi.fn()}
      error={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("Fluxport LLM API Key")).toHaveValue(
    "test•••••••••••••••-key",
  );
});
