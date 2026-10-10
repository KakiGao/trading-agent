import { useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  ArrowUpRight,
  RefreshCw,
  Bell,
  BrainCircuit,
  Timer,
  ShieldCheck,
  CircleDot,
  ChevronRight,
} from "lucide-react";
import {
  Button,
  Badge,
  Empty,
  Markdown,
  SubmitForm,
  PageHeading,
  NotificationPermission,
} from "./components.jsx";
import { analystOptions, dateLabel, request } from "./data.js";

export function Portfolio({ settings, save, error }) {
  const [book, setBook] = useState(() => structuredClone(settings.portfolio));
  const update = (key, value) => setBook((prev) => ({ ...prev, [key]: value }));
  const updatePosition = (index, key, value) =>
    setBook((prev) => ({
      ...prev,
      positions: prev.positions.map((p, i) =>
        i === index ? { ...p, [key]: value } : p,
      ),
    }));
  return (
    <>
      <PageHeading eyebrow="YOUR PORTFOLIO" title="让每份建议，都与你有关。">
        管理持仓、成本与现金，让研究团队理解你的账户。
      </PageHeading>
      <section className="card form-card">
        <SubmitForm onSubmit={() => save({ portfolio: book })} onError={error}>
          <div className="card-heading">
            <h2>我的账户</h2>
            <label className="switch">
              <input
                type="checkbox"
                checked={book.enabled}
                onChange={(e) => update("enabled", e.target.checked)}
              />
              <span>分析时使用持仓</span>
            </label>
          </div>
          <div className="form-grid">
            <label>
              可用现金
              <input
                type="number"
                min="0"
                step="any"
                value={book.cash}
                required
                onChange={(e) =>
                  update(
                    "cash",
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
              />
            </label>
            <label>
              账户币种
              <select
                value={book.currency}
                onChange={(e) => update("currency", e.target.value)}
              >
                {["USD", "HKD", "CNY", "JPY", "EUR", "GBP"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="hint">
            按同一报价币种维护账户，当前不做汇率换算。持仓启用且列表为空，表示空仓。
          </p>
          <div className="position-labels">
            <span>股票代码</span>
            <span>持有数量</span>
            <span>平均成本</span>
            <span />
          </div>
          {book.positions.map((p, i) => (
            <div className="position-row" key={i}>
              <input
                aria-label={`股票代码 ${i + 1}`}
                value={p.ticker}
                placeholder="NVDA"
                maxLength={24}
                required
                onChange={(e) => updatePosition(i, "ticker", e.target.value)}
              />
              <input
                aria-label={`持有数量 ${i + 1}`}
                type="number"
                min="0.00000001"
                step="any"
                required
                value={p.quantity}
                onChange={(e) =>
                  updatePosition(
                    i,
                    "quantity",
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
              />
              <input
                aria-label={`平均成本 ${i + 1}`}
                type="number"
                min="0"
                step="any"
                required
                value={p.average_price}
                onChange={(e) =>
                  updatePosition(
                    i,
                    "average_price",
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
              />
              <button
                type="button"
                className="icon-button"
                aria-label={`删除持仓 ${p.ticker || i + 1}`}
                onClick={() =>
                  update(
                    "positions",
                    book.positions.filter((_, n) => n !== i),
                  )
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {!book.positions.length && (
            <div className="form-empty">
              还没有持仓。添加后，下一次分析会使用保存的账户信息。
            </div>
          )}
          <Button
            type="button"
            className="subtle"
            onClick={() =>
              update("positions", [
                ...book.positions,
                { ticker: "", quantity: "", average_price: "" },
              ])
            }
          >
            <Plus size={14} />
            添加持仓
          </Button>
          <div className="form-footer">
            <p>交易后请手动更新。研究时持仓会发送给所配置的模型服务。</p>
            <Button type="submit" className="primary">
              保存持仓 <ArrowUpRight size={15} />
            </Button>
          </div>
        </SubmitForm>
      </section>
    </>
  );
}

export function Schedule({ settings, nextDue, save, error }) {
  const [form, setForm] = useState(() => ({ ...settings }));
  const [notify, setNotify] = useState(settings.notify_mode);
  const update = (key, value) => setForm((p) => ({ ...p, [key]: value }));
  return (
    <>
      <PageHeading
        eyebrow="YOUR RESEARCH RHYTHM"
        title="研究，按你的节奏进行。"
      >
        设置自动分析时间，或随时从自选列表发起研究。
      </PageHeading>
      <div className="settings-columns">
        <section className="card form-card">
          <SubmitForm
            onSubmit={() =>
              save(
                Object.fromEntries(
                  [
                    "schedule_enabled",
                    "schedule_mode",
                    "daily_time",
                    "interval_minutes",
                    "weekdays_only",
                  ].map((k) => [k, form[k]]),
                ),
              )
            }
            onError={error}
          >
            <div className="card-heading">
              <h2>运行计划</h2>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={form.schedule_enabled}
                  onChange={(e) => update("schedule_enabled", e.target.checked)}
                />
                <span>开启自动分析</span>
              </label>
            </div>
            <div className="schedule-preview">
              <Timer size={22} />
              <div>
                <span>下次自动分析</span>
                <strong>{dateLabel(nextDue, true)}</strong>
              </div>
              <span className="timezone">北京时间</span>
            </div>
            <div className="form-grid">
              <label>
                运行方式
                <select
                  value={form.schedule_mode}
                  onChange={(e) => update("schedule_mode", e.target.value)}
                >
                  <option value="daily">每天指定时间</option>
                  <option value="interval">每隔一段时间</option>
                </select>
              </label>
              {form.schedule_mode === "daily" ? (
                <label>
                  运行时间 · 北京时间
                  <input
                    type="time"
                    required
                    value={form.daily_time}
                    onChange={(e) => update("daily_time", e.target.value)}
                  />
                </label>
              ) : (
                <label>
                  间隔分钟数
                  <input
                    type="number"
                    min={15}
                    max={1440}
                    required
                    value={form.interval_minutes}
                    onChange={(e) =>
                      update("interval_minutes", Number(e.target.value))
                    }
                  />
                </label>
              )}
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.weekdays_only}
                onChange={(e) => update("weekdays_only", e.target.checked)}
              />
              仅周一至周五运行
            </label>
            <div className="info-note">
              <ShieldCheck size={18} />
              <p>
                关闭网页后任务仍会执行。电脑休眠、关机时暂停，恢复后最多补跑一次。星期筛选不包含各交易所的节假日和盘中时段。
              </p>
            </div>
            <div className="form-footer">
              <p>自动分析自选股与已启用的持仓，使用模型额度。</p>
              <Button type="submit" className="primary">
                保存运行计划
              </Button>
            </div>
          </SubmitForm>
        </section>
        <section className="card form-card">
          <div className="card-heading">
            <h2>把注意力留给重要变化</h2>
            <Bell size={18} />
          </div>
          <SubmitForm
            onSubmit={() => save({ notify_mode: notify })}
            onError={error}
          >
            <label>
              何时提醒
              <select
                value={notify}
                onChange={(e) => setNotify(e.target.value)}
              >
                <option value="changes">
                  评级变化，或首次出现非「持有」建议
                </option>
                <option value="all">每次分析完成</option>
              </select>
            </label>
            <p className="hint">分析失败也会产生消息，所有结果都会保留。</p>
            <Button type="submit">保存提醒偏好</Button>
          </SubmitForm>
          <NotificationPermission onError={error} />
          <p className="hint">
            弹窗提醒需要保持页面打开。关闭后新消息会保存在消息中心，不接入任何外部通知平台。
          </p>
        </section>
      </div>
    </>
  );
}

export function Memory({ error }) {
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      setData(await request("memory"));
    } catch (e) {
      error(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  return (
    <>
      <PageHeading
        eyebrow="DECISION MEMORY"
        title="每次判断，都留下经验。"
        action={
          <Button busy={loading} onClick={load}>
            <RefreshCw size={14} />
            刷新记忆
          </Button>
        }
      >
        原项目的历史决策和事后复盘，为下一次研究提供参考。
      </PageHeading>
      <div className="memory-steps">
        {[
          ["01", "保存判断", "每个标的、每个日期记录一条原始决策。"],
          [
            "02",
            "观察结果",
            `默认观察 ${data?.holding_days || 5} 个交易日，后续分析时评估收益。`,
          ],
          ["03", "带入经验", "读取同标的经验与跨标的教训，不修改模型参数。"],
        ].map(([n, title, body]) => (
          <article key={n} className="card">
            <span>{n}</span>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </div>
      {!data?.entries.length ? (
        <section className="card">
          <Empty
            icon={BrainCircuit}
            title={loading ? "正在读取记忆" : "记忆从第一次决策开始"}
          >
            完成分析后，历史决策和复盘会出现在这里。
          </Empty>
        </section>
      ) : (
        data.entries.map((e, i) => (
          <details
            key={`${e.ticker}-${e.date}-${i}`}
            className="card memory-entry"
          >
            <summary>
              <div className="ticker-avatar">{e.ticker.slice(0, 2)}</div>
              <strong>{e.ticker}</strong>
              <Badge rating={e.rating} />
              <span className="memory-status">
                {e.pending ? "等待复盘" : "已复盘"}
              </span>
              <time>{e.date}</time>
              <ChevronRight size={16} />
            </summary>
            <div className="memory-entry-body">
              {e.raw && (
                <p className="info-note">
                  标的后续收益 {e.raw} · 相对基准 {e.alpha} · {e.holding}
                  （非账户实际盈亏）
                </p>
              )}
              <h3>原始决策</h3>
              <Markdown>{e.decision}</Markdown>
              <h3>事后复盘</h3>
              <Markdown>
                {e.reflection || "尚未到复盘窗口，或等待后续分析时补齐结果。"}
              </Markdown>
            </div>
          </details>
        ))
      )}
    </>
  );
}

export function Notifications({ items, onRead, onOpen, error }) {
  return (
    <>
      <PageHeading
        eyebrow="YOUR INBOX"
        title="留意值得行动的新消息。"
        action={<Button onClick={onRead}>全部标为已读</Button>}
      >
        建议变化和研究异常，在这里集中查看。
      </PageHeading>
      <section className="card inbox">
        {items.length ? (
          items.map((n) => (
            <article key={n.id} className={`notice ${n.seen ? "" : "unread"}`}>
              <div className="notice-icon">
                <Bell size={18} />
              </div>
              <div>
                <h3>{n.title}</h3>
                <p>{n.body}</p>
                {n.job_id && (
                  <button
                    className="text-button"
                    onClick={() => onOpen(n.job_id)}
                  >
                    查看研究 <ArrowUpRight size={14} />
                  </button>
                )}
              </div>
              <time>{dateLabel(n.created)}</time>
              {!n.seen && <i />}
            </article>
          ))
        ) : (
          <Empty icon={Bell} title="目前没有新消息">
            当研究结论有变化时，你会在这里看到提醒。
          </Empty>
        )}
      </section>
      <section className="card form-card">
        <NotificationPermission onError={error} />
      </section>
    </>
  );
}

export function Preferences({
  settings,
  keyConfigured,
  save,
  mutate,
  refresh,
  message,
  error,
}) {
  const [key, setKey] = useState(""),
    [analysts, setAnalysts] = useState(settings.analysts);
  return (
    <>
      <PageHeading
        eyebrow="RESEARCH PREFERENCES"
        title="配置你的专属研究团队。"
      >
        沿用 DeepSeek 与中文输出，密钥只保存在本机。
      </PageHeading>
      <div className="settings-columns">
        <section className="card form-card">
          <div className="card-heading">
            <h2>模型连接</h2>
            <span className={`badge ${keyConfigured ? "positive" : "neutral"}`}>
              {keyConfigured ? "密钥已配置" : "待配置"}
            </span>
          </div>
          <div className="model-cards">
            <div>
              <CircleDot size={19} />
              <span>资料分析与讨论</span>
              <strong>DeepSeek Flash</strong>
            </div>
            <div>
              <CircleDot size={19} />
              <span>研究经理与组合经理</span>
              <strong>DeepSeek V4 Pro</strong>
            </div>
          </div>
          <SubmitForm
            onError={error}
            onSubmit={async () => {
              await mutate("key", { key });
              setKey("");
              await refresh();
              message("密钥已保存");
            }}
          >
            <label>
              DeepSeek API Key
              <input
                type="password"
                autoComplete="new-password"
                placeholder="填写或替换密钥"
                minLength={8}
                required
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
            <p className="hint">
              保存后不显示密钥。真实分析使用模型额度，保存不代表已验证余额。
            </p>
            <Button type="submit" className="primary">
              保存密钥
            </Button>
          </SubmitForm>
        </section>
        <section className="card form-card">
          <div className="card-heading">
            <h2>参与分析的团队</h2>
            <BrainCircuit size={18} />
          </div>
          <SubmitForm onError={error} onSubmit={() => save({ analysts })}>
            <div className="analyst-options">
              {analystOptions.map(([id, title, desc]) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={analysts.includes(id)}
                    onChange={(e) =>
                      setAnalysts(
                        e.target.checked
                          ? [...analysts, id]
                          : analysts.filter((a) => a !== id),
                      )
                    }
                  />
                  <span>
                    <strong>{title}</strong>
                    <small>{desc}</small>
                  </span>
                </label>
              ))}
            </div>
            <p className="hint">
              至少选择一位分析师。研究结论仍会经过多空辩论和风险评估。
            </p>
            <Button type="submit" className="primary">
              保存分析团队
            </Button>
          </SubmitForm>
        </section>
      </div>
    </>
  );
}
