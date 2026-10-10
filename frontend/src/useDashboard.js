import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "./data.js";

export default function useDashboard(onMessage) {
  const [state, setState] = useState(null);
  const [online, setOnline] = useState(true);
  const current = useRef(null);
  const hidden = useRef(new Set());
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++version.current;
    const data = await request("state");
    if (ticket !== version.current) return;
    data.jobs = data.jobs.filter(
      (j) => j.status !== "cancelled" && !hidden.current.has(j.id),
    );
    current.current = data;
    setState(data);
    setOnline(true);
    return data;
  }, []);
  useEffect(() => {
    let alive = true,
      timer;
    async function poll() {
      try {
        await refresh();
      } catch {
        if (alive) setOnline(false);
      }
      if (alive) timer = setTimeout(poll, 4000);
    }
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [refresh]);
  const mutate = useCallback(
    async (path, data) => {
      try {
        return await request(path, data, current.current?.csrf);
      } catch (error) {
        if (error.message.includes("页面会话")) await refresh();
        throw error;
      }
    },
    [refresh],
  );
  const save = async (patch) => {
    await mutate("settings", { ...current.current.settings, ...patch });
    await refresh();
    onMessage("设置已保存");
  };
  const run = async (ticker) => {
    const result = await mutate("run", { ticker: ticker || null });
    await refresh();
    onMessage(result.message);
    return result;
  };
  const cancel = async (id) => {
    await mutate(`cancel/${id}`, {});
    hidden.current.add(id);
    setState((previous) => ({
      ...previous,
      jobs: previous.jobs.filter((j) => j.id !== id),
    }));
    await refresh();
    onMessage("任务已取消，并从研究动态移除");
  };
  return { state, online, refresh, mutate, save, run, cancel };
}
