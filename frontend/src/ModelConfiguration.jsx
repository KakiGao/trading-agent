import { useState } from "react";
import { Cpu, KeyRound, Check, ShieldCheck } from "lucide-react";
import { Button, SubmitForm } from "./components.jsx";

export default function ModelConfiguration({
  settings,
  providerKeys,
  providerKeyMasks,
  save,
  mutate,
  refresh,
  message,
  error,
}) {
  const defaults = {
    provider: "deepseek",
    fluxport_model: "gpt-6-sol",
    fluxport_base_url: "https://api.uselg.top/v1",
  };
  const [form, setForm] = useState({ ...defaults, ...settings.models }),
    [key, setKey] = useState(""),
    [focused, setFocused] = useState(false);
  const selected = form.provider,
    active = settings.models?.provider || "deepseek",
    mask = providerKeyMasks?.[selected] || "";
  const showingMask = Boolean(mask && !key && !focused);
  const submit = async () => {
    if (key.trim()) {
      await mutate("key", { provider: selected, key });
      setKey("");
      setFocused(false);
    }
    await save({ models: form });
    await refresh();
    message("模型配置已保存，将在新提交的研究中生效");
  };
  return (
    <div className="model-page">
      <section className="card form-card">
        <div className="card-heading">
          <h2>模型配置</h2>
          <span className="badge">
            当前使用{" "}
            {active === "fluxport" ? "Fluxport · gpt-6-sol" : "DeepSeek"}
          </span>
        </div>
        <SubmitForm onSubmit={submit} onError={error}>
          <div
            className="provider-options"
            role="radiogroup"
            aria-label="模型服务"
          >
            {[
              ["deepseek", "DeepSeek", "Flash + V4 Pro"],
              ["fluxport", "Fluxport", "gpt-6-sol"],
            ].map(([id, name, model]) => (
              <label key={id} className={selected === id ? "selected" : ""}>
                <input
                  type="radio"
                  name="provider"
                  value={id}
                  checked={selected === id}
                  onChange={() => {
                    setForm({ ...form, provider: id });
                    setKey("");
                    setFocused(false);
                  }}
                />
                <Cpu size={22} />
                <span>
                  <strong>{name}</strong>
                  <small>{model}</small>
                </span>
                {selected === id && <Check size={17} />}
              </label>
            ))}
          </div>
          {selected === "fluxport" ? (
            <>
              <div className="form-grid">
                <label>
                  模型
                  <select
                    value={form.fluxport_model}
                    onChange={(e) =>
                      setForm({ ...form, fluxport_model: e.target.value })
                    }
                  >
                    <option value="gpt-6-sol">gpt-6-sol</option>
                  </select>
                </label>
                <label>
                  接口地址
                  <input
                    type="url"
                    required
                    value={form.fluxport_base_url}
                    onChange={(e) =>
                      setForm({ ...form, fluxport_base_url: e.target.value })
                    }
                  />
                </label>
              </div>
              <p className="hint">
                使用 Fluxport 的独立 LLM
                密钥；资料分析、多空讨论和最终决策均使用 gpt-6-sol。
              </p>
            </>
          ) : (
            <div className="model-cards">
              <div>
                <span>资料分析与讨论</span>
                <strong>deepseek-flash</strong>
              </div>
              <div>
                <span>研究经理与组合经理</span>
                <strong>deepseek-v4-pro</strong>
              </div>
            </div>
          )}
          <label>
            {selected === "fluxport" ? "Fluxport LLM" : "DeepSeek"} API Key
            <input
              type={showingMask ? "text" : "password"}
              autoComplete="new-password"
              spellCheck={false}
              value={showingMask ? mask : key}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(e) => setKey(e.target.value)}
              placeholder={mask ? "输入新密钥以更换" : "填写密钥"}
            />
          </label>
          <p className="hint">
            {providerKeys?.[selected]
              ? "本机已保存此服务的密钥；下方为打码显示，点击即可更换。"
              : "此服务尚未配置密钥。"}
            保存配置不会发起模型请求，也不代表已验证模型权限或余额。
          </p>
          <Button type="submit" className="primary">
            <KeyRound size={14} />
            保存模型配置
          </Button>
        </SubmitForm>
      </section>
      <section className="card form-card model-info">
        <ShieldCheck size={24} />
        <h2>独立配置，按任务生效</h2>
        <p>
          两个服务分别保存密钥。切换只影响新提交的研究；已在队列中的任务继续使用提交时的模型配置。
        </p>
        <p>
          密钥保存在本机 .env；页面只显示打码预览，完整密钥不会写入交易日志或报告。Fluxport
          通过兼容接口执行研究，连接失败会明确报错。
        </p>
        <p>启用持仓时，研究资料、当前持仓和成本会发送给所选择的模型服务。</p>
      </section>
    </div>
  );
}
