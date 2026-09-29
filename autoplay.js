(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const PRESETS = {
    custom:    { url: "", auth: "bearer" },
    openrouter:{ url: "https://openrouter.ai/api/v1", auth: "bearer" },
    openai:    { url: "https://api.openai.com/v1", auth: "bearer" },
    deepseek:  { url: "https://api.deepseek.com/v1", auth: "bearer" },
    siliconflow:{url: "https://api.siliconflow.cn/v1", auth: "bearer" },
    dashscope: { url: "https://dashscope.aliyuncs.com/compatible-mode/v1", auth: "bearer" },
    zhipu:     { url: "https://open.bigmodel.cn/api/paas/v4", auth: "bearer" },
    moonshot:  { url: "https://api.moonshot.cn/v1", auth: "bearer" },
    volcark:   { url: "https://ark.cn-beijing.volces.com/api/v3", auth: "bearer" },
    xai:       { url: "https://api.x.ai/v1", auth: "bearer" },
    groq:      { url: "https://api.groq.com/openai/v1", auth: "bearer" },
    together:  { url: "https://api.together.xyz/v1", auth: "bearer" },
    mistral:   { url: "https://api.mistral.ai/v1", auth: "bearer" },
    ollama:    { url: "http://127.0.0.1:11434/v1", auth: "none" },
    lmstudio:  { url: "http://127.0.0.1:1234/v1", auth: "none" }
  };

  const DEFAULT_RULES = `你正在参加 Blackgate AI Game 的长期推理决策测试。

你的目标不是只答对当前一个 NPC，而是尽可能完成完整 14 天任期，同时维持：
- 城库
- 治安
- 经济
- 民意
- 渗透警戒

你只能根据每回合提供的“玩家可见状态”判断，不得要求源码、hidden state、真实身份、ideal action、localStorage、DevTools 或其他作弊信息。

动作：
- allow：放行
- reject：拒绝
- search：搜查。会消耗搜查令，但不会结束案件；搜查后仍需做最终处置。
- isolate：隔离。占用隔离位，适合怪物、传染病、危险诅咒等高危对象。
- next_day：只在日结阶段进入下一天。

决策原则：
1. 先读当天审查令，因为它会改变证据权重。
2. 单一异常通常不是铁证，优先寻找不同类别证据是否互相印证。
3. 搜查令和隔离位有限，要考虑机会成本。
4. 误拒、误隔离会伤害经济和民意。
5. 漏放危险目标会伤害治安并提高警戒，而且后果可能延迟出现。
6. 你负责的是长期生存，不是单案准确率。
7. 日结反馈属于合法信息，应根据反馈修正后续策略。
8. 不要因为上一案的结果机械地对下一案采用相同动作。

请给出一个唯一动作，并给出不超过两句话的简短理由。不要输出详细思维链。`;

  const runtime = {
    apiKey: "",
    running: false,
    paused: false,
    stopRequested: false,
    requestCount: 0,
    totalTokens: 0,
    latencies: [],
    logEntries: [],
    runId: null,
    model: "",
    promptHash: "",
    dayMemories: [],
    recentDecisions: [],
    lastResponse: null
  };

  function setBadge(el, text, cls = "") {
    el.textContent = text;
    el.className = "badge " + cls;
  }

  function setConnection(text, ok = null) {
    $("connectStatus").textContent = text;
    if (ok === true) setBadge($("connectionBadge"), "已连接", "ok");
    else if (ok === false) setBadge($("connectionBadge"), "连接失败", "bad");
    else setBadge($("connectionBadge"), "未连接");
  }

  function normalizeBase(raw) {
    const value = String(raw || "").trim();
    if (!value) throw new Error("请填写 API URL");
    const u = new URL(value);
    let p = u.pathname.replace(/\/+$/, "");
    p = p.replace(/\/chat\/completions$/i, "");
    p = p.replace(/\/responses$/i, "");
    p = p.replace(/\/models$/i, "");
    u.pathname = p || "";
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/+$/, "");
  }

  function redactedUrl(raw) {
    try {
      const u = new URL(raw);
      u.search = "";
      u.hash = "";
      return u.toString();
    } catch {
      return "[invalid-url]";
    }
  }

  function authHeaders() {
    const mode = $("authMode").value;
    const key = runtime.apiKey || $("apiKey").value.trim();
    const headers = { "content-type": "application/json" };
    if (mode === "bearer" && key) headers.Authorization = "Bearer " + key;
    if (mode === "api-key" && key) headers["api-key"] = key;
    if (mode === "x-api-key" && key) headers["x-api-key"] = key;
    return headers;
  }

  function modelHeaders() {
    const h = authHeaders();
    delete h["content-type"];
    return h;
  }

  function parseExtraBody() {
    const raw = $("extraBody").value.trim();
    if (!raw) return {};
    let obj;
    try { obj = JSON.parse(raw); }
    catch { throw new Error("额外 JSON Body 不是合法 JSON"); }
    if (!obj || Array.isArray(obj) || typeof obj !== "object") throw new Error("额外 JSON Body 必须是 JSON 对象");
    for (const k of ["model","messages","input"]) delete obj[k];
    return obj;
  }

  function resolveModel() {
    return $("manualModel").value.trim() || $("modelSelect").value.trim();
  }

  function parseModels(data) {
    let list = [];
    if (Array.isArray(data?.data)) list = data.data;
    else if (Array.isArray(data?.models)) list = data.models;
    else if (Array.isArray(data)) list = data;

    const ids = list.map(x => {
      if (typeof x === "string") return x;
      return x?.id || x?.name || x?.model || "";
    }).filter(Boolean);

    return [...new Set(ids)].sort((a,b) => a.localeCompare(b));
  }

  function looksCorsError(error) {
    return error instanceof TypeError || /failed to fetch|networkerror|cors/i.test(String(error?.message || error));
  }

  async function fetchModels() {
    const base = normalizeBase($("apiUrl").value);
    runtime.apiKey = $("apiKey").value.trim();
    $("corsHint").hidden = true;
    $("fetchModelsBtn").disabled = true;
    setConnection("正在获取 /models…", null);

    try {
      const res = await fetch(base + "/models", {
        method: "GET",
        headers: modelHeaders(),
        cache: "no-store"
      });
      const text = await res.text();
      if (!res.ok) throw new Error("HTTP " + res.status + " · " + text.slice(0, 280));

      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error("模型列表不是 JSON 响应"); }

      const models = parseModels(data);
      if (!models.length) throw new Error("已连接，但 /models 没有返回可识别的模型列表");

      $("modelSelect").innerHTML = models.map(id => {
        const o = document.createElement("option");
        o.value = id;
        o.textContent = id;
        return o.outerHTML;
      }).join("");
      $("modelSelect").disabled = false;
      $("modelCount").textContent = models.length + " models";
      $("manualModel").value = "";
      setConnection("成功获取 " + models.length + " 个模型", true);
      addSystemLog("models", "已从 " + redactedUrl(base) + "/models 获取 " + models.length + " 个模型。");
      return models;
    } catch (error) {
      setConnection(error.message || String(error), false);
      $("modelSelect").disabled = true;
      $("modelCount").textContent = "0 models";
      if (looksCorsError(error)) $("corsHint").hidden = false;
      addErrorLog("models", error);
      throw error;
    } finally {
      $("fetchModelsBtn").disabled = false;
    }
  }

  function reasoningInstruction() {
    const effort = $("reasoningEffort").value;
    if (effort === "auto") return "使用模型默认推理强度。";
    const map = {
      low: "使用较低推理强度，快速但仍需遵守规则。",
      medium: "使用中等推理强度，平衡速度与审慎。",
      high: "使用高推理强度，优先审慎权衡长期后果。",
      xhigh: "使用最高可用推理强度，充分检查证据冲突与长期资源风险。"
    };
    return map[effort] || "";
  }

  function outputProtocol(allowed) {
    return `
当前允许动作：${allowed.join(", ")}。

请只返回一个 JSON 对象，不要 Markdown，不要代码块：
{"action":"允许动作之一","reason":"不超过两句话","confidence":0-100}

reason 只写简短结论依据，不要输出详细思维链。action 必须严格来自当前 allowed_actions。`;
  }

  function memoryBlock() {
    if ($("contextMode").value === "stateless") return "";
    const n = Number($("memoryTurns").value || 8);
    const days = runtime.dayMemories.slice(-4);
    const recent = runtime.recentDecisions.slice(-n);
    if (!days.length && !recent.length) return "";

    return `
[RUN_MEMORY]
已经获得的日结反馈：
${days.length ? days.join("\n") : "暂无"}

最近决策：
${recent.length ? recent.join("\n") : "暂无"}
[/RUN_MEMORY]`;
  }

  function systemPrompt(state) {
    return [
      $("rulesPrompt").value.trim() || DEFAULT_RULES,
      "",
      "[REASONING_LEVEL]",
      reasoningInstruction(),
      "[/REASONING_LEVEL]",
      memoryBlock(),
      outputProtocol(state.allowed_actions || [])
    ].join("\n");
  }

  function statePrompt(state, repairMessage = "") {
    const packet = JSON.stringify(state, null, 2);
    return `${repairMessage ? repairMessage + "\n\n" : ""}[BLACKGATE_VISIBLE_STATE]
${packet}
[/BLACKGATE_VISIBLE_STATE]

根据当前状态选择唯一动作。`;
  }

  function usageOf(data) {
    const u = data?.usage || {};
    const prompt = Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0;
    const completion = Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0;
    const total = Number(u.total_tokens ?? (prompt + completion)) || 0;
    return { prompt, completion, total };
  }

  function contentOf(data) {
    if (typeof data?.choices?.[0]?.message?.content === "string") return data.choices[0].message.content;
    const msg = data?.choices?.[0]?.message?.content;
    if (Array.isArray(msg)) return msg.map(x => x?.text || x?.content || "").join("\n");
    if (typeof data?.output_text === "string") return data.output_text;
    if (Array.isArray(data?.output)) {
      return data.output.flatMap(item => item?.content || [])
        .map(part => part?.text || part?.content || "")
        .filter(Boolean).join("\n");
    }
    if (typeof data?.text === "string") return data.text;
    return "";
  }

  function shouldRetryWithoutReasoning(status, body) {
    if (![400,404,422].includes(status)) return false;
    return /reasoning[_ ]?effort|reasoning.*unsupported|unknown.*reasoning|extra.*field/i.test(body);
  }

  async function postJson(url, payload, allowReasoningRetry = true) {
    const started = performance.now();
    const res = await fetch(url, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
    const raw = await res.text();
    const latency = Math.round(performance.now() - started);

    if (!res.ok) {
      if (allowReasoningRetry && payload.reasoning_effort && shouldRetryWithoutReasoning(res.status, raw)) {
        const clone = { ...payload };
        delete clone.reasoning_effort;
        addWarningLog("reasoning", "中转站不接受 reasoning_effort，已自动去掉该参数重试；提示词中的推理等级仍保留。");
        return postJson(url, clone, false);
      }
      if (allowReasoningRetry && payload.reasoning && shouldRetryWithoutReasoning(res.status, raw)) {
        const clone = { ...payload };
        delete clone.reasoning;
        addWarningLog("reasoning", "中转站不接受 reasoning 参数，已自动去掉该参数重试；提示词中的推理等级仍保留。");
        return postJson(url, clone, false);
      }
      const error = new Error("HTTP " + res.status + " · " + raw.slice(0, 700));
      error.status = res.status;
      error.latency = latency;
      throw error;
    }

    let data;
    try { data = JSON.parse(raw); }
    catch {
      const error = new Error("模型接口返回了非 JSON 响应：" + raw.slice(0, 500));
      error.status = res.status;
      error.latency = latency;
      throw error;
    }
    return { data, latency };
  }

  async function callChat(base, model, state, repairMessage = "") {
    const extra = parseExtraBody();
    const payload = {
      ...extra,
      model,
      messages: [
        { role: "system", content: systemPrompt(state) },
        { role: "user", content: statePrompt(state, repairMessage) }
      ],
      stream: false
    };
    const effort = $("reasoningEffort").value;
    if (effort !== "auto") payload.reasoning_effort = effort;
    return postJson(base + "/chat/completions", payload, true);
  }

  async function callResponses(base, model, state, repairMessage = "") {
    const extra = parseExtraBody();
    const payload = {
      ...extra,
      model,
      input: [
        { role: "system", content: systemPrompt(state) },
        { role: "user", content: statePrompt(state, repairMessage) }
      ]
    };
    const effort = $("reasoningEffort").value;
    if (effort !== "auto") payload.reasoning = { effort };
    return postJson(base + "/responses", payload, true);
  }

  async function callOnce(state, repairMessage = "") {
    const base = normalizeBase($("apiUrl").value);
    const model = resolveModel();
    const mode = $("apiMode").value;

    if (!model) throw new Error("请选择或填写模型");

    if (mode === "chat") {
      const r = await callChat(base, model, state, repairMessage);
      return { ...r, api_mode: "chat" };
    }
    if (mode === "responses") {
      const r = await callResponses(base, model, state, repairMessage);
      return { ...r, api_mode: "responses" };
    }

    try {
      const r = await callChat(base, model, state, repairMessage);
      return { ...r, api_mode: "chat" };
    } catch (error) {
      if (![404,405,501].includes(error.status)) throw error;
      addWarningLog("protocol", "Chat Completions 不可用，自动尝试 Responses API。");
      const r = await callResponses(base, model, state, repairMessage);
      return { ...r, api_mode: "responses" };
    }
  }

  async function callWithRetry(state, repairMessage = "") {
    const max = Number($("maxRetries").value || 3);
    let lastError;
    for (let attempt = 1; attempt <= max; attempt++) {
      try {
        return await callOnce(state, repairMessage);
      } catch (error) {
        lastError = error;
        const retryable = error.status === 429 || error.status >= 500 || looksCorsError(error);
        addErrorLog("api", error, { attempt, retryable });
        if (!retryable || attempt >= max) break;
        const wait = Math.min(8000, 650 * Math.pow(2, attempt - 1));
        setRunStatus("接口失败，" + wait + "ms 后重试 " + attempt + "/" + max);
        await sleep(wait);
      }
    }
    throw lastError;
  }

  function extractJsonObject(text) {
    const raw = String(text || "").trim();
    try { return JSON.parse(raw); } catch {}
    const fenced = raw.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/i);
    if (fenced) {
      try { return JSON.parse(fenced[1].trim()); } catch {}
    }
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch {}
    }
    return null;
  }

  function parseDecision(text, allowed) {
    const obj = extractJsonObject(text);
    let action = String(obj?.action || "").trim().toLowerCase().replace(/-/g, "_");
    const reason = String(obj?.reason || "").trim();
    const confidence = Number(obj?.confidence);

    const aliases = {
      a:"allow", r:"reject", s:"search", i:"isolate", n:"next_day",
      "放行":"allow", "拒绝":"reject", "搜查":"search", "隔离":"isolate",
      "下一天":"next_day", "次日":"next_day"
    };
    action = aliases[action] || action;

    if (!action) {
      const lower = String(text || "").toLowerCase();
      for (const [k,v] of Object.entries(aliases)) {
        if (k.length > 1 && lower.includes(k)) { action = v; break; }
      }
      if (!action) {
        const m = lower.match(/\b(allow|reject|search|isolate|next[_ -]?day)\b/);
        if (m) action = m[1].replace(/[ -]/g,"_");
      }
    }

    if (!allowed.includes(action)) {
      return { ok:false, action, reason, confidence:Number.isFinite(confidence)?confidence:null };
    }
    return { ok:true, action, reason, confidence:Number.isFinite(confidence)?Math.max(0,Math.min(100,confidence)):null };
  }

  async function getDecision(state) {
    let repairMessage = "";
    for (let repair = 0; repair < 2; repair++) {
      const response = await callWithRetry(state, repairMessage);
      runtime.requestCount++;
      runtime.latencies.push(response.latency);
      const usage = usageOf(response.data);
      runtime.totalTokens += usage.total;
      const text = contentOf(response.data);
      runtime.lastResponse = text;
      const parsed = parseDecision(text, state.allowed_actions || []);

      if (parsed.ok) {
        return { ...parsed, text, usage, latency:response.latency, api_mode:response.api_mode };
      }

      addWarningLog("parse", "模型回复无法解析为当前合法动作：" + (text || "[empty]").slice(0, 280));
      repairMessage = "上一次回复无法执行。请重新回答，action 必须严格从以下列表选择：" + (state.allowed_actions || []).join(", ") + "。只输出 JSON。";
    }
    throw new Error("连续两次无法从模型回复中得到合法动作");
  }

  function sanitizeLogEntry(entry) {
    return {
      ts: entry.ts,
      type: entry.type,
      day: entry.day,
      case_id: entry.case_id,
      phase: entry.phase,
      action: entry.action,
      reason: entry.reason,
      confidence: entry.confidence,
      latency_ms: entry.latency_ms,
      usage: entry.usage,
      api_mode: entry.api_mode,
      message: entry.message,
      attempt: entry.attempt,
      retryable: entry.retryable
    };
  }

  function persistLogs() {
    if (!runtime.runId) return;
    try {
      const key = "blackgate_autoplay_logs_v1";
      const all = JSON.parse(localStorage.getItem(key) || "{}");
      all[runtime.runId] = {
        run_id: runtime.runId,
        username: $("username").value.trim(),
        model: runtime.model,
        api_url: redactedUrl($("apiUrl").value),
        reasoning_effort: $("reasoningEffort").value,
        prompt_hash: runtime.promptHash,
        logs: runtime.logEntries.map(sanitizeLogEntry)
      };
      const keys = Object.keys(all);
      if (keys.length > 20) {
        for (const old of keys.slice(0, keys.length - 20)) delete all[old];
      }
      localStorage.setItem(key, JSON.stringify(all));
    } catch {}
  }

  function logHtml(entry) {
    if (entry.type === "error") {
      return `<div class="log-item log-error"><div class="log-top"><span class="log-action">ERROR</span><span class="log-meta">${escapeHtml(entry.ts)}</span></div><div class="log-reason">${escapeHtml(entry.message)}</div><div class="log-detail"><span>attempt ${entry.attempt || "-"}</span><span>retryable ${entry.retryable ? "yes" : "no"}</span></div></div>`;
    }
    if (entry.type === "warning" || entry.type === "system") {
      return `<div class="log-item ${entry.type === "warning" ? "log-warning" : ""}"><div class="log-top"><span class="log-action">${entry.type.toUpperCase()}</span><span class="log-meta">${escapeHtml(entry.ts)}</span></div><div class="log-reason">${escapeHtml(entry.message)}</div></div>`;
    }
    return `<div class="log-item">
      <div class="log-top"><span class="log-action ${escapeHtml(entry.action)}">${escapeHtml(entry.action)}</span><span class="log-meta">Day ${entry.day} · ${escapeHtml(entry.case_id || entry.phase || "")}</span></div>
      <div class="log-reason">${escapeHtml(entry.reason || "模型未提供简短理由")}</div>
      <div class="log-detail">
        <span>confidence ${entry.confidence ?? "—"}</span>
        <span>${entry.latency_ms ?? "—"} ms</span>
        <span>${entry.usage?.total ?? 0} tokens</span>
        <span>${escapeHtml(entry.api_mode || "")}</span>
      </div>
    </div>`;
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  function renderLogs() {
    const list = $("logList");
    if (!runtime.logEntries.length) {
      list.innerHTML = '<div class="log-empty">运行后这里会记录模型、动作、理由、置信度、延迟、Token、错误与重试。不会记录 API Key。</div>';
      return;
    }
    list.innerHTML = runtime.logEntries.slice(-120).map(logHtml).join("");
    list.scrollTop = list.scrollHeight;
  }

  function addLog(entry) {
    runtime.logEntries.push({ ts:new Date().toISOString(), ...entry });
    if (runtime.logEntries.length > 2000) runtime.logEntries = runtime.logEntries.slice(-2000);
    renderLogs();
    persistLogs();
  }

  function addSystemLog(kind, message) {
    addLog({ type:"system", message:"[" + kind + "] " + message });
  }

  function addWarningLog(kind, message) {
    addLog({ type:"warning", message:"[" + kind + "] " + message });
  }

  function addErrorLog(kind, error, extra = {}) {
    addLog({
      type:"error",
      message:"[" + kind + "] " + (error?.message || String(error)),
      attempt:extra.attempt,
      retryable:!!extra.retryable
    });
  }

  function updateMetrics(state) {
    $("dayMetric").textContent = state?.day ?? "—";
    $("caseMetric").textContent = state?.case_counter || "—";
    $("requestMetric").textContent = runtime.requestCount;
    $("tokenMetric").textContent = runtime.totalTokens.toLocaleString();
    const avgLatency = runtime.latencies.length
      ? Math.round(runtime.latencies.reduce((a,b)=>a+b,0) / runtime.latencies.length)
      : null;
    $("latencyMetric").textContent = avgLatency === null ? "—" : avgLatency + "ms";
    $("phaseMetric").textContent = state?.phase || "—";

    let progress = 0;
    if (state?.day) {
      let within = 0;
      const m = String(state.case_counter || "").match(/(\d+)\s*\/\s*(\d+)/);
      if (m && Number(m[2])) within = Math.max(0, Math.min(1, (Number(m[1]) - 1) / Number(m[2])));
      progress = Math.min(100, (((state.day - 1) + within) / 14) * 100);
      if (state.phase === "finished") progress = 100;
    }
    $("progressBar").style.width = progress + "%";
  }

  function setRunStatus(text) {
    $("runStatus").textContent = text;
  }

  function updateRunButtons() {
    $("startRunBtn").disabled = runtime.running;
    $("pauseBtn").disabled = !runtime.running;
    $("stopBtn").disabled = !runtime.running;
    $("pauseBtn").textContent = runtime.paused ? "继续" : "暂停";
  }

  function rememberDecision(before, decision, after) {
    const label = "Day " + (before.day || "?") + " " + (before.case?.id || before.phase || "") +
      " → " + decision.action + (decision.reason ? "｜" + decision.reason : "");
    runtime.recentDecisions.push(label);
    if (runtime.recentDecisions.length > 40) runtime.recentDecisions = runtime.recentDecisions.slice(-40);

    if (before.phase === "report" && before.report) {
      const memory = "Day " + before.day + " 日结：" +
        (before.report.comment || "") + "｜资源 " + JSON.stringify(before.resources || {});
      if (!runtime.dayMemories.includes(memory)) runtime.dayMemories.push(memory);
    }
    if (after.phase === "report" && after.report) {
      const memory = "Day " + after.day + " 日结：" +
        (after.report.comment || "") + "｜资源 " + JSON.stringify(after.resources || {});
      if (!runtime.dayMemories.includes(memory)) runtime.dayMemories.push(memory);
    }
  }

  async function hashPrompt(text) {
    try {
      const bytes = new TextEncoder().encode(text);
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("");
    } catch {
      return "unavailable";
    }
  }

  async function waitWhilePaused() {
    while (runtime.running && runtime.paused && !runtime.stopRequested) {
      await sleep(200);
    }
  }

  async function autonomousLoop() {
    try {
      while (runtime.running && !runtime.stopRequested) {
        await waitWhilePaused();
        if (!runtime.running || runtime.stopRequested) break;

        const before = window.BlackgateAI.getState();
        updateMetrics(before);

        if (before.phase === "finished") {
          finishRun(before);
          break;
        }

        setRunStatus("AI 正在判断 · Day " + before.day + " · " + (before.case?.id || before.phase));
        const decision = await getDecision(before);

        if (!before.allowed_actions.includes(decision.action)) {
          throw new Error("模型动作不在 allowed_actions 中：" + decision.action);
        }

        const after = await window.BlackgateAI.act(decision.action);
        const recorded = window.BlackgateRunRecorder.recordAction(before, decision.action, after);

        rememberDecision(before, decision, after);
        addLog({
          type:"decision",
          day:before.day,
          case_id:before.case?.id || "",
          phase:before.phase,
          action:decision.action,
          reason:decision.reason,
          confidence:decision.confidence,
          latency_ms:decision.latency,
          usage:decision.usage,
          api_mode:decision.api_mode
        });

        updateMetrics(after);

        if (recorded?.report || after.phase === "finished") {
          if (recorded?.run?.id) runtime.runId = recorded.run.id;
          finishRun(after, recorded);
          break;
        }

        const delay = Number($("stepDelay").value || 0);
        if (delay) await sleep(delay);
      }
    } catch (error) {
      addErrorLog("run", error, { retryable:false });
      runtime.running = false;
      runtime.paused = false;
      setBadge($("runBadge"), "ERROR", "bad");
      $("runTitle").textContent = "运行中断";
      setRunStatus(error.message || String(error));
      updateRunButtons();
    }
  }

  function finishRun(state, recorded = null) {
    runtime.running = false;
    runtime.paused = false;
    runtime.stopRequested = false;
    setBadge($("runBadge"), "DONE", "done");
    $("runTitle").textContent = "本局完成";
    setRunStatus("AI 已自动跑完。本机日志与复盘报告已生成；API Key 未写入任何记录。");
    updateRunButtons();
    updateMetrics(state);

    const id = recorded?.run?.id || runtime.runId;
    if (id) {
      $("reportLink").href = "./report.html?id=" + encodeURIComponent(id);
      $("reportLink").hidden = false;
    }
    persistLogs();
  }

  async function startRun() {
    if (runtime.running) return;
    try {
      runtime.apiKey = $("apiKey").value.trim();
      const base = normalizeBase($("apiUrl").value);
      const model = resolveModel();
      if (!model) throw new Error("请先获取并选择模型，或手动填写模型名");
      if ($("authMode").value !== "none" && !runtime.apiKey) throw new Error("请输入 API Key");

      parseExtraBody();

      runtime.running = true;
      runtime.paused = false;
      runtime.stopRequested = false;
      runtime.requestCount = 0;
      runtime.totalTokens = 0;
      runtime.latencies = [];
      runtime.logEntries = [];
      runtime.dayMemories = [];
      runtime.recentDecisions = [];
      runtime.model = model;
      runtime.promptHash = await hashPrompt($("rulesPrompt").value.trim() || DEFAULT_RULES);
      $("reportLink").hidden = true;

      setBadge($("runBadge"), "RUNNING", "running");
      $("runTitle").textContent = $("username").value.trim() + " · " + model;
      setRunStatus("正在初始化游戏并启动自主决策循环…");
      updateRunButtons();
      renderLogs();

      let state = await window.BlackgateAI.reset($("difficulty").value, true);
      if (state?.phase === "start") {
        await sleep(120);
        const current = window.BlackgateAI.getState();
        state = current?.phase === "start" ? await window.BlackgateAI.act("start") : current;
      }
      const run = window.BlackgateRunRecorder.start({
        player_type:"ai",
        participant:$("username").value.trim() || "anonymous",
        model,
        provider:$("presetSelect").selectedOptions[0]?.textContent || "Custom relay",
        difficulty:$("difficulty").value,
        source:"autonomous-web",
        prompt_profile:"custom:" + runtime.promptHash.slice(0,16)
      }, state);
      runtime.runId = run.id;

      addSystemLog("run", "开始自主测试 · user=" + ($("username").value.trim() || "anonymous") +
        " · model=" + model + " · endpoint=" + redactedUrl(base) +
        " · reasoning=" + $("reasoningEffort").value +
        " · prompt_sha256=" + runtime.promptHash.slice(0,16));

      updateMetrics(state);
      autonomousLoop();
    } catch (error) {
      runtime.running = false;
      runtime.paused = false;
      setBadge($("runBadge"), "ERROR", "bad");
      $("runTitle").textContent = "无法开始";
      setRunStatus(error.message || String(error));
      addErrorLog("start", error, { retryable:false });
      updateRunButtons();
    }
  }

  async function testConnection() {
    runtime.apiKey = $("apiKey").value.trim();
    $("testBtn").disabled = true;
    $("corsHint").hidden = true;
    try {
      const base = normalizeBase($("apiUrl").value);
      const res = await fetch(base + "/models", { headers:modelHeaders(), cache:"no-store" });
      if (!res.ok) {
        const t = await res.text();
        throw new Error("HTTP " + res.status + " · " + t.slice(0,220));
      }
      setConnection("连接成功", true);
      addSystemLog("connect", "连接成功：" + redactedUrl(base));
    } catch (error) {
      setConnection(error.message || String(error), false);
      if (looksCorsError(error)) $("corsHint").hidden = false;
      addErrorLog("connect", error, { retryable:false });
    } finally {
      $("testBtn").disabled = false;
    }
  }

  function exportLogs() {
    const payload = {
      schema:"blackgate-autoplay-log/1",
      exported_at:new Date().toISOString(),
      run_id:runtime.runId,
      username:$("username").value.trim(),
      model:runtime.model || resolveModel(),
      api_url:redactedUrl($("apiUrl").value),
      reasoning_effort:$("reasoningEffort").value,
      prompt_hash:runtime.promptHash,
      api_key_saved:false,
      request_count:runtime.requestCount,
      total_tokens:runtime.totalTokens,
      logs:runtime.logEntries.map(sanitizeLogEntry)
    };
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "blackgate-run-" + (runtime.runId || Date.now()) + ".json";
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }

  function applyPreset() {
    const p = PRESETS[$("presetSelect").value] || PRESETS.custom;
    if (p.url || $("presetSelect").value !== "custom") $("apiUrl").value = p.url;
    $("authMode").value = p.auth;
    setConnection("等待连接", null);
  }

  $("presetSelect").addEventListener("change", applyPreset);
  $("fetchModelsBtn").addEventListener("click", () => fetchModels().catch(()=>{}));
  $("testBtn").addEventListener("click", testConnection);
  $("clearKeyBtn").addEventListener("click", () => {
    runtime.apiKey = "";
    $("apiKey").value = "";
    setConnection("API Key 已从当前页面清除", null);
  });
  $("startRunBtn").addEventListener("click", startRun);
  $("pauseBtn").addEventListener("click", () => {
    if (!runtime.running) return;
    runtime.paused = !runtime.paused;
    setBadge($("runBadge"), runtime.paused ? "PAUSED" : "RUNNING", runtime.paused ? "paused" : "running");
    setRunStatus(runtime.paused ? "已暂停，不会继续调用模型接口。" : "已继续运行。");
    updateRunButtons();
  });
  $("stopBtn").addEventListener("click", () => {
    runtime.stopRequested = true;
    runtime.running = false;
    runtime.paused = false;
    setBadge($("runBadge"), "STOPPED", "bad");
    $("runTitle").textContent = "用户停止";
    setRunStatus("已停止自动测试。不会再发送新的模型请求。");
    updateRunButtons();
    persistLogs();
  });
  $("exportLogBtn").addEventListener("click", exportLogs);
  $("clearLogBtn").addEventListener("click", () => {
    runtime.logEntries = [];
    renderLogs();
  });
  $("modelSelect").addEventListener("change", () => {
    if ($("modelSelect").value) $("manualModel").value = "";
  });

  window.addEventListener("blackgate-run-finished", e => {
    if (e.detail?.run?.id) runtime.runId = e.detail.run.id;
  });

  window.addEventListener("pagehide", () => {
    runtime.apiKey = "";
  });

  $("rulesPrompt").value = DEFAULT_RULES;
  applyPreset();
  updateRunButtons();
  renderLogs();
})();
