import { describe, it, expect } from "vitest";
import { dayOffset, filterActivityJobs } from "./data.js";

describe("filterActivityJobs", () => {
  const today = "2026-10-11";
  const jobs = [
    { id: "1", trade_date: "2026-10-11", status: "completed" },
    { id: "2", trade_date: "2026-10-05", status: "completed" },
    { id: "3", trade_date: "2026-10-04", status: "completed" },
    { id: "4", trade_date: "2026-09-01", status: "running" },
  ];

  it("defaults to last 7 calendar days inclusive", () => {
    expect(dayOffset(today, 6)).toBe("2026-10-05");
    const ids = filterActivityJobs(jobs, { preset: "7", today }).map((j) => j.id);
    expect(ids).toEqual(["1", "2", "4"]);
  });

  it("keeps active jobs outside the window", () => {
    const ids = filterActivityJobs(jobs, { preset: "7", today }).map((j) => j.id);
    expect(ids).toContain("4");
  });

  it("supports custom range", () => {
    const ids = filterActivityJobs(jobs, {
      preset: "custom",
      from: "2026-10-04",
      to: "2026-10-05",
      today,
    }).map((j) => j.id);
    expect(ids).toEqual(["2", "3", "4"]);
  });
});
