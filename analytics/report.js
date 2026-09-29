(() => {
  "use strict";

  const round = (n, d = 1) => Number.isFinite(n) ? Number(n.toFixed(d)) : 0;
  const pct = (n, d) => d ? round((n / d) * 100, 1) : 0;

  function finalDecisions(run) {
    return (run.days || []).flatMap(day => day.decisions || []);
  }

  function reports(run) {
    return (run.days || []).filter(day => day.report).map(day => day.report);
  }

  function parseAuditLine(line) {
    const action = line.match(/你的处置：([^（·\s]+)/)?.[1] || "";
    const ideal = line.match(/建议处置：([^·\s]+)/)?.[1] || "";
    const truth = line.match(/实际身份：([^\n]+?)(?:你的处置|$)/)?.[1]?.trim() || "";
    return { line, action, ideal, truth, correct: !!action && !!ideal && action === ideal };
  }

  function phaseStats(decisions, fromDay, toDay) {
    const list = decisions.filter(x => x.day >= fromDay && x.day <= toDay);
    const finals = list.filter(x => ["allow","reject","isolate"].includes(x.action));
    return {
      count: finals.length,
      allow_rate: pct(finals.filter(x => x.action === "allow").length, finals.length),
      enforcement_rate: pct(finals.filter(x => ["reject","isolate"].includes(x.action)).length, finals.length),
      search_rate: pct(list.filter(x => x.action === "search").length, finals.length)
    };
  }

  function classifyStyle(metrics) {
    const tags = [];
    if (metrics.search_rate >= 38) tags.push("证据核验型");
    else if (metrics.search_rate <= 16) tags.push("低搜查依赖");

    if (metrics.enforcement_rate >= 48) tags.push("强执法");
    else if (metrics.allow_rate >= 66) tags.push("高放行倾向");

    if (metrics.isolate_rate >= 16) tags.push("积极隔离");
    if (metrics.avg_daily_accuracy >= 82) tags.push("高命中");
    if (metrics.early.count && metrics.late.count) {
      if (metrics.late.enforcement_rate - metrics.early.enforcement_rate >= 15) tags.push("后期趋严");
      if (metrics.early.enforcement_rate - metrics.late.enforcement_rate >= 15) tags.push("后期放宽");
    }

    return tags.length ? tags : ["均衡决策"];
  }

  function failureReason(finalState) {
    const r = finalState?.resources || {};
    const reasons = [];
    if ((r.public ?? 1) <= 0) reasons.push("民意归零");
    if ((r.security ?? 1) <= 0) reasons.push("治安归零");
    if ((r.economy ?? 1) <= 0) reasons.push("经济归零");
    if ((r.threat ?? 0) >= 100) reasons.push("渗透警戒达到 100");
    if ((r.gold ?? 0) <= -30) reasons.push("城库跌破 -30G");
    return reasons.length ? reasons.join("、") : ((finalState?.day || 0) >= 14 ? "完成 14 天任期" : "未触发明确崩溃指标");
  }

  function inferStrengths(metrics) {
    const out = [];
    const scope = metrics.audit_scope === "full" ? "全量复盘" : "抽样复核";
    if (metrics.overall_accuracy >= 80) out.push("整体决策准确率较高，单案判断总体稳定。");
    if (metrics.search_rate >= 30 && metrics.search_rate <= 55) out.push("会主动用搜查换取信息，不完全依赖表面证据。");
    if (metrics.audit_false_positive_rate <= 15 && metrics.audit_samples >= 4) out.push(scope + "中误伤正常目标较少。");
    if (metrics.audit_false_negative_rate <= 15 && metrics.audit_samples >= 4) out.push(scope + "中危险目标漏放较少。");
    if (metrics.searched_accuracy > metrics.unsearched_accuracy + 5 && metrics.searched_cases >= 3) out.push("搜查后的决策准确率明显高于未搜查案件，说明额外证据被有效利用。");
    if (metrics.isolate_precision >= 80 && metrics.isolates >= 3) out.push("隔离动作命中率较高，对高危目标的最终处置较准确。");
    if (metrics.days_survived >= 14) out.push("完成完整 14 天，长期资源控制具备一定韧性。");
    return out.length ? out : ["当前样本还不足以形成稳定优势结论。"];
  }

  function inferRisks(metrics, finalState) {
    const out = [];
    const scope = metrics.audit_scope === "full" ? "全量复盘" : "抽样复核";
    if (metrics.audit_false_positive_rate >= 30) out.push(scope + "中误拒/误隔离偏高，容易用民意与经济换安全。");
    if (metrics.audit_false_negative_rate >= 30) out.push(scope + "中危险目标漏放偏高，安全侧存在明显尾部风险。");
    if (metrics.allow_rate >= 68) out.push("整体放行比例偏高，遇到伪装良好的高危目标时风险更大。");
    if (metrics.enforcement_rate >= 55) out.push("强制处置比例偏高，长期容易压低民意与经济。");
    if (metrics.search_rate >= 60) out.push("搜查使用非常积极，可能过早耗尽搜查令并增加审查压力。");
    if (metrics.searched_cases >= 3 && metrics.searched_accuracy + 8 < metrics.unsearched_accuracy) out.push("搜查案件反而更容易判断错误，可能存在对复杂证据过度反应的问题。");
    if ((finalState?.resources?.public ?? 100) < 25) out.push("最终民意处于危险区，说明后期强制措施的社会成本偏高。");
    if ((finalState?.resources?.security ?? 100) < 25) out.push("最终治安处于危险区，说明漏放危险目标造成了累积伤害。");
    if ((finalState?.resources?.threat ?? 0) > 55) out.push("最终渗透警戒偏高，说明长期漏放/风险控制仍有不足。");
    return out.length ? out : ["没有观察到特别突出的单一失败模式。"];
  }

  function timeline(run) {
    return (run.days || []).map(day => {
      const report = day.report || {};
      return {
        day: day.day,
        decisions: (day.decisions || []).filter(x => ["allow","reject","isolate"].includes(x.action)).length,
        searches: (day.decisions || []).filter(x => x.action === "search").length,
        accuracy: report.accuracy ?? null,
        end_resources: report.end_resources || null,
        report_title: report.title || ""
      };
    });
  }

  function analyze(run, finalState) {
    const events = (run.days || []).flatMap(day => day.decisions || []);
    const decisions = events.filter(x => ["allow","reject","isolate"].includes(x.action));
    const searchCount = events.filter(x => x.action === "search").length;
    const allowCount = decisions.filter(x => x.action === "allow").length;
    const rejectCount = decisions.filter(x => x.action === "reject").length;
    const isolateCount = decisions.filter(x => x.action === "isolate").length;

    const daily = reports(run);
    const accuracies = daily.map(x => x.accuracy).filter(Number.isFinite);
    const sampledAudit = daily.flatMap(x => (x.audit || []).map(parseAuditLine)).filter(x => x.action && x.ideal);
    const fullAudit = daily.flatMap(x => x.full_audit || []);

    const useFull = fullAudit.length > 0;
    const audit = useFull ? fullAudit : sampledAudit;
    const fp = useFull
      ? audit.filter(x => x.ideal === "allow" && ["reject","isolate"].includes(x.action)).length
      : audit.filter(x => x.ideal === "放行" && ["拒绝","隔离"].includes(x.action)).length;
    const fn = useFull
      ? audit.filter(x => ["reject","isolate"].includes(x.ideal) && x.action === "allow").length
      : audit.filter(x => ["拒绝","隔离"].includes(x.ideal) && x.action === "放行").length;

    const exactCorrect = useFull ? fullAudit.filter(x => x.correct).length : 0;
    const searchedAudit = useFull ? fullAudit.filter(x => x.searched) : [];
    const unsearchedAudit = useFull ? fullAudit.filter(x => !x.searched) : [];
    const actionPrecision = action => {
      if (!useFull) return 0;
      const set = fullAudit.filter(x => x.action === action);
      return pct(set.filter(x => x.correct).length, set.length);
    };

    const early = phaseStats(events, 1, 4);
    const mid = phaseStats(events, 5, 9);
    const late = phaseStats(events, 10, 14);

    const resources = finalState?.resources || {};
    const score = Math.round(((resources.security || 0) + (resources.economy || 0) + (resources.public || 0) + (100 - (resources.threat || 0))) / 4);
    const daysSurvived = Math.min(14, Math.max(
      finalState?.day || 0,
      ...((run.days || []).map(x => x.day || 0))
    ));

    const metrics = {
      cases: decisions.length,
      searches: searchCount,
      allows: allowCount,
      rejects: rejectCount,
      isolates: isolateCount,
      search_rate: pct(searchCount, decisions.length),
      allow_rate: pct(allowCount, decisions.length),
      reject_rate: pct(rejectCount, decisions.length),
      isolate_rate: pct(isolateCount, decisions.length),
      enforcement_rate: pct(rejectCount + isolateCount, decisions.length),
      avg_daily_accuracy: accuracies.length ? round(accuracies.reduce((a,b) => a+b, 0) / accuracies.length, 1) : 0,
      overall_accuracy: useFull ? pct(exactCorrect, fullAudit.length) : (accuracies.length ? round(accuracies.reduce((a,b) => a+b, 0) / accuracies.length, 1) : 0),
      audit_scope: useFull ? "full" : "sample",
      audit_samples: audit.length,
      audit_false_positive_rate: pct(fp, audit.length),
      audit_false_negative_rate: pct(fn, audit.length),
      searched_cases: searchedAudit.length,
      searched_accuracy: pct(searchedAudit.filter(x => x.correct).length, searchedAudit.length),
      unsearched_accuracy: pct(unsearchedAudit.filter(x => x.correct).length, unsearchedAudit.length),
      allow_precision: actionPrecision("allow"),
      reject_precision: actionPrecision("reject"),
      isolate_precision: actionPrecision("isolate"),
      early, mid, late,
      days_survived: daysSurvived,
      final_score: score,
      completed: daysSurvived >= 14 && !/任期中止/.test(finalState?.report?.title || "")
    };

    const style = classifyStyle(metrics);
    const failure = failureReason(finalState);
    const strengths = inferStrengths(metrics);
    const risks = inferRisks(metrics, finalState);

    let summary = `${run.meta?.model || run.meta?.participant || "本次玩家"}共处理 ${metrics.cases} 个案件，使用 ${metrics.searches} 次搜查，存活至第 ${metrics.days_survived} 天。`;
    if (metrics.overall_accuracy) summary += ` ${metrics.audit_scope === "full" ? "全量" : "已记录"}决策准确率约 ${metrics.overall_accuracy}%。`;
    summary += ` 决策风格：${style.join("、")}。最终结局：${failure}。`;

    const swing = round(late.enforcement_rate - early.enforcement_rate, 1);
    const adaptation = !late.count || !early.count ? "样本不足"
      : swing >= 15 ? `后期强制处置率比前期高 ${swing} 个百分点，说明风险压力上升后明显趋严。`
      : swing <= -15 ? `后期强制处置率比前期低 ${Math.abs(swing)} 个百分点，说明后期更愿意放行以保护其他资源。`
      : "前后期强制处置比例变化不大，策略整体较稳定。";

    return {
      schema: "blackgate-postmortem/1",
      generated_at: new Date().toISOString(),
      run_id: run.id,
      meta: run.meta,
      metrics,
      style,
      summary,
      adaptation,
      strengths,
      risks,
      failure_reason: failure,
      final_resources: resources,
      timeline: timeline(run),
      audit_samples: sampledAudit,
      full_audit_count: fullAudit.length
    };
  }

  function leaderboardEntry(run, report) {
    return {
      schema: "blackgate-leaderboard/1",
      run_id: run.id,
      participant: run.meta?.participant || "",
      model: run.meta?.model || "Unknown",
      provider: run.meta?.provider || "",
      player_type: run.meta?.player_type || "ai",
      difficulty: run.meta?.difficulty || "normal",
      days: report.metrics.days_survived,
      score: report.metrics.final_score,
      avg_accuracy: report.metrics.avg_daily_accuracy,
      cases: report.metrics.cases,
      searches: report.metrics.searches,
      style: report.style,
      final_resources: report.final_resources,
      completed: report.metrics.completed,
      source: run.meta?.source || "web",
      ended_at: run.ended_at || new Date().toISOString()
    };
  }

  window.BlackgateReport = Object.freeze({ analyze, leaderboardEntry });
})();
