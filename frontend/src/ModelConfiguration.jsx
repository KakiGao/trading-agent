import { useState } from "react";
import { Cpu, KeyRound, Check, ShieldCheck } from "lucide-react";
import { Button, SubmitForm } from "./components.jsx";

const providers = [
  ["deepseek", "DeepSeek", "Flash + V4 Pro"],
  ["fluxport", "Fluxport", "gpt-6-sol"],
  ["grsai", "GrsAI", "gemini-3.1-pro"],
  ["g4f", "GPT4Free", "Gemini Flash / Pro"],
];

const labels = {
  deepseek: "DeepSeek",
  fluxport: "Fluxport · gpt-6-sol",
  grsai: "GrsAI · gemini-3.1-pro",
  g4f: "GPT4Free · Gemini",
};

const keyLabels = {
  deepseek: "DeepSeek",
  fluxport: "Fluxport LLM",
  grsai: "GrsAI LLM",
  g4f: "GPT4Free",
};

export default function ModelConfiguration({
  settings,
  providerKeys,
  providerKeyMasks,
  g4fCookiesConfigured,
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
    grsai_model: "gemini-3.1-pro",
    grsai_base_url: "https://grsaiapi.com/v1",
    g4f_model: "gemini-2.5-flash",
    g4f_thinking: "low",
  };
  const models = { ...defaults, ...settings.models };
  if (models.provider === "gemini_web") models.provider = "g4f";
  const [form, setForm] = useState(models),
    [key, setKey] = useState(""),
    [cookieJson, setCookieJson] = useState(""),
    [focused, setFocused] = useState(false);
  const selected = form.provider,
    active =
      settings.models?.provider === "gemini_web"
        ? "g4f"
        : settings.models?.provider || "deepseek",
    mask = providerKeyMasks?.[selected] || "";
  const showingMask = Boolean(mask && !key && !focused);
  const submit = async () => {
    if (selected === "g4f") {
      if (cookieJson.trim()) {
        await mutate("key", { provider: "g4f", key: cookieJson.trim() });
      } else if (form.g4f_model === "gemini-3.1-pro" && !g4fCookiesConfigured) {
        throw new Error("gemini-3.1-pro 需要粘贴 Google Cookie JSON");
      }
    } else if (key.trim()) {
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
          <span className="badge">当前使用 {labels[active] || "DeepSeek"}</span>
        </div>
        <SubmitForm onSubmit={submit} onError={error}>
          <div
            className="provider-options"
            role="radiogroup"
            aria-label="模型服务"
          >
            {providers.map(([id, name, model]) => (
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
          ) : selected === "grsai" ? (
            <>
              <div className="form-grid">
                <label>
                  模型
                  <select
                    value={form.grsai_model || "gemini-3.1-pro"}
                    onChange={(e) =>
                      setForm({ ...form, grsai_model: e.target.value })
                    }
                  >
                    <option value="gemini-3.1-pro">gemini-3.1-pro</option>
                  </select>
                </label>
                <label>
                  接口地址
                  <input
                    type="url"
                    required
                    value={form.grsai_base_url || "https://grsaiapi.com/v1"}
                    onChange={(e) =>
                      setForm({ ...form, grsai_base_url: e.target.value })
                    }
                  />
                </label>
              </div>
              <p className="hint">
                使用 GrsAI 的独立 LLM 密钥（OpenAI 兼容 · grsaiapi.com）；资料分析与最终决策均使用
                gemini-3.1-pro。
              </p>
            </>
          ) : selected === "g4f" ? (
            <>
              <div className="form-grid">
                <label>
                  模型
                  <select
                    value={form.g4f_model || "gemini-2.5-flash"}
                    onChange={(e) =>
                      setForm({ ...form, g4f_model: e.target.value })
                    }
                  >
                    <option value="gemini-3.1-pro">gemini-3.1-pro</option>
                    <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                    <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                  </select>
                </label>
                <label>
                  思考强度
                  <select
                    value={form.g4f_thinking || "low"}
                    onChange={(e) =>
                      setForm({ ...form, g4f_thinking: e.target.value })
                    }
                  >
                    <option value="low">低（默认）</option>
                    <option value="medium">中（扩展思考）</option>
                    <option value="high">高（扩展思考）</option>
                  </select>
                </label>
              </div>
              <p className="hint">
                通过 gpt4free（g4f）调用 Gemini。Flash 可匿名；Pro
                需粘贴 Cookie。思考强度对应 g4f 的 reasoning_effort：低=关闭扩展思考，中/高=开启。
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
          {selected === "g4f" ? (
            <label className="cookie-field">
              <div className="cookie-field-head">
                <span>Google Cookie JSON</span>
                <span
                  className={`cookie-status ${g4fCookiesConfigured ? "ready" : "missing"}`}
                >
                  {g4fCookiesConfigured ? "已配置" : "未配置"}
                </span>
              </div>
              <textarea
                rows={7}
                spellCheck={false}
                autoComplete="off"
                value={cookieJson}
                onChange={(e) => setCookieJson(e.target.value)}
                placeholder={
                  g4fCookiesConfigured
                    ? "本机已有 Cookie，粘贴新 JSON 可覆盖更新…"
                    : '[\n  { "name": "__Secure-1PSID", "value": "…" }\n]'
                }
              />
            </label>
          ) : (
            <label>
              {keyLabels[selected] || "DeepSeek"} API Key
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
          )}
          <p className="hint">
            {selected === "g4f"
              ? g4fCookiesConfigured
                ? "本机已保存 Google Cookie（不回显明文）。Flash 可不填；换 Cookie 时粘贴新 JSON 后保存。"
                : "尚未保存 Cookie。选 Pro 时必须粘贴；选 Flash 可跳过。"
              : providerKeys?.[selected]
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
          各服务分别保存密钥。切换只影响新提交的研究；已在队列中的任务继续使用提交时的模型配置。
        </p>
        <p>
          密钥保存在本机 .env；页面只显示打码预览，完整密钥不会写入交易日志或报告。Fluxport /
          GrsAI 走 OpenAI 兼容接口；GPT4Free 走免费 Gemini 通道。
        </p>
        <p>启用持仓时，研究资料、当前持仓和成本会发送给所选择的模型服务。</p>
      </section>
    </div>
  );
}
