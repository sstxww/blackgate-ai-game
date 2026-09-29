(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const run = window.BlackgateRunRecorder.get(qs.get("id") || "latest");

  function metric(v, fallback = "—") {
    return Number.isFinite(v) ? v : fallback;
  }

  function setList(id, items) {
    $(id).innerHTML = (items || []).map(x => "<li>" + escapeHtml(x) + "</li>").join("");
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  function phaseCard(title, p) {
    return `<article class="phase"><b>${title}</b><dl>
      <dt>案件数</dt><dd>${p.count}</dd>
      <dt>放行率</dt><dd>${p.allow_rate}%</dd>
      <dt>强制处置率</dt><dd>${p.enforcement_rate}%</dd>
      <dt>搜查率</dt><dd>${p.search_rate}%</dd>
    </dl></article>`;
  }

  function bar(title, value) {
    return `<article class="bar-card"><span class="label">${title}</span><br><b>${value}%</b><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0,Math.min(100,value))}%"></div></div></article>`;
  }

  function publicIssueUrl(run, report) {
    const payload = window.BlackgateReport.leaderboardEntry(run, report);
    const title = `[Blackgate Run] ${payload.model} · Day ${payload.days} · Score ${payload.score}`;
    const body = `感谢提交 Blackgate 运行记录。\n\n> 该入口默认进入“社区自报榜”，不等同于固定种子验证榜。\n\n\`\`\`blackgate-run\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`;
    return "https://github.com/sstxww/blackgate-ai-game/issues/new?title=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(body);
  }

  if (!run) {
    $("emptyState").hidden = false;
    $("reportView").hidden = true;
    $("submitBtn").disabled = true;
    return;
  }

  const report = run.postmortem || window.BlackgateReport.analyze(run, {
    day: Math.max(...run.days.map(x => x.day)),
    resources: run.days.at(-1)?.report?.end_resources || {},
    report: { title: run.days.at(-1)?.report?.title || "" }
  });

  $("emptyState").hidden = true;
  $("reportView").hidden = false;
  $("modelName").textContent = run.meta?.model || run.meta?.participant || "未命名玩家";
  $("summaryText").textContent = report.summary;
  $("styleTags").innerHTML = report.style.map(x => "<span>" + escapeHtml(x) + "</span>").join("");
  $("daysMetric").textContent = report.metrics.days_survived;
  $("scoreMetric").textContent = report.metrics.final_score;
  $("accuracyMetric").textContent = metric(report.metrics.overall_accuracy);
  $("searchMetric").textContent = metric(report.metrics.search_rate);
  $("adaptation").textContent = report.adaptation;
  $("failureReason").textContent = "结局：" + report.failure_reason;
  setList("strengths", report.strengths);
  setList("risks", report.risks);

  $("actionBars").innerHTML = [
    bar("放行率", report.metrics.allow_rate),
    bar("拒绝率", report.metrics.reject_rate),
    bar("隔离率", report.metrics.isolate_rate),
    bar("搜查率", report.metrics.search_rate)
  ].join("");

  const diag = (label, value, suffix="%") => `<article class="diag"><span>${label}</span><b>${metric(value)}${suffix}</b></article>`;
  $("diagnosticGrid").innerHTML = [
    diag("误拒/误隔离率", report.metrics.audit_false_positive_rate),
    diag("危险目标漏放率", report.metrics.audit_false_negative_rate),
    diag("搜查后准确率", report.metrics.searched_accuracy),
    diag("未搜查准确率", report.metrics.unsearched_accuracy),
    diag("拒绝命中率", report.metrics.reject_precision),
    diag("隔离命中率", report.metrics.isolate_precision)
  ].join("");
  $("auditScopeNote").textContent = report.metrics.audit_scope === "full"
    ? "这些指标来自日结后解锁的全量复盘真相；运行过程中不会提供给 AI。"
    : "当前只拿到了游戏日结抽样，因此误拒/漏放指标属于抽样估计。";

  $("phaseGrid").innerHTML = [
    phaseCard("前期 · Day 1–4", report.metrics.early),
    phaseCard("中期 · Day 5–9", report.metrics.mid),
    phaseCard("后期 · Day 10–14", report.metrics.late)
  ].join("");

  $("timelineBody").innerHTML = report.timeline.map(x => {
    const r = x.end_resources || {};
    return `<tr><td>Day ${x.day}</td><td>${x.decisions}</td><td>${x.searches}</td><td>${x.accuracy ?? "—"}</td><td>${r.security ?? "—"}</td><td>${r.economy ?? "—"}</td><td>${r.public ?? "—"}</td><td>${r.threat ?? "—"}</td></tr>`;
  }).join("");

  $("auditList").innerHTML = report.audit_samples.length
    ? report.audit_samples.map(x => `<div class="audit ${x.correct ? "good" : "bad"}">${escapeHtml(x.line)}</div>`).join("")
    : '<div class="audit">没有可用的日结复核样本。</div>';

  $("rawJson").textContent = JSON.stringify(report, null, 2);
  $("submitBtn").addEventListener("click", () => location.href = publicIssueUrl(run, report));
})();
