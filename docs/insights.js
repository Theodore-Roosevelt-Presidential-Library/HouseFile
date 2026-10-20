/* "Dates & members" tab: booking lead time, visit and purchase timing, ticket
   types and membership, all from aggregate counts in data/stats.json (insights).
   Uses d3 and the helpers defined by the main dashboard script (fmt, cssVar,
   showTip, hideTip). */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const F = d3.format(","), P = v => (v == null || !isFinite(v)) ? "—" : (v >= 10 ? Math.round(v) : v.toFixed(1)) + "%";
  const share = (a, b) => b ? 100 * a / b : null;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const monthFmt = k => d3.timeFormat("%b ’%y")(d3.timeParse("%Y-%m")(k));
  const dayFmt = k => d3.timeFormat("%b %-d")(d3.timeParse("%Y-%m-%d")(k));
  const tile = (label, value, sub) => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="delta">${sub}</div>` : ""}</div>`;

  // Vertical bars. data: [{key, label, y}], opts: {highlight(key)->bool, tip(d)->html, every}
  function vbars(el, data, opts = {}) {
    if (!data.length) { el.innerHTML = '<p class="empty">No data yet.</p>'; return; }
    const W = opts.w || 560, H = opts.h || 230, m = { t: 14, r: 8, b: 36, l: 44 };
    const x = d3.scaleBand(data.map(d => d.key), [m.l, W - m.r]).paddingInner(opts.pad ?? 0.22);
    const y = d3.scaleLinear([0, d3.max(data, d => d.y) || 1], [H - m.b, m.t]).nice();
    const svg = d3.select(el).html("").append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", opts.aria || "");
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format("~s")).tickSize(-(W - m.l - m.r))).call(a => a.select(".domain").remove());
    const every = opts.every || Math.ceil(data.length / 9);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).tickValues(x.domain().filter((d, i) => i % every === 0)).tickFormat(k => (data.find(d => d.key === k) || {}).label || k).tickSize(0))
      .call(a => a.select(".domain").attr("stroke", cssVar("--axis")))
      .call(a => a.selectAll("text").attr("dy", "1.1em"));
    const bw = Math.min(opts.maxBar || 30, x.bandwidth());
    svg.append("g").selectAll("path").data(data).join("path")
      .attr("d", d => { const x0 = x(d.key) + (x.bandwidth() - bw) / 2, y0 = y(d.y), y1 = y(0), r = Math.min(3, bw / 2, Math.max(0, y1 - y0)); return `M${x0},${y1}V${y0 + r}a${r},${r} 0 0 1 ${r},-${r}h${bw - 2 * r}a${r},${r} 0 0 1 ${r},${r}V${y1}Z`; })
      .attr("fill", d => opts.highlight && opts.highlight(d) ? cssVar("--s2") : cssVar("--s1"))
      .on("mousemove", (e, d) => showTip(e, opts.tip ? opts.tip(d) : `<b>${esc(d.label)}</b> · ${F(d.y)}`)).on("mouseleave", hideTip);
  }

  // 100% stacked bars, one per row. rows: [{key,label,parts:[n...]}], bands: [{label,color}]
  function stacked(el, rows, bands, opts = {}) {
    if (!rows.length) { el.innerHTML = '<p class="empty">No data yet.</p>'; return; }
    const W = opts.w || 1100, rowH = 22, gap = 8, m = { t: 6, r: 8, b: 6, l: 64 };
    const H = m.t + m.b + rows.length * (rowH + gap);
    const x = d3.scaleLinear([0, 1], [m.l, W - m.r]);
    const svg = d3.select(el).html("").append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", opts.aria || "");
    rows.forEach((r, i) => {
      const tot = d3.sum(r.parts), y0 = m.t + i * (rowH + gap);
      svg.append("text").attr("x", m.l - 8).attr("y", y0 + rowH / 2 + 4).attr("text-anchor", "end").attr("font-size", 11.5).attr("fill", cssVar("--ink-2")).text(r.label);
      let acc = 0;
      r.parts.forEach((v, j) => {
        if (!tot || !v) { acc += v; return; }
        const a = acc / tot, b = (acc + v) / tot; acc += v;
        svg.append("rect").attr("x", x(a)).attr("y", y0).attr("width", Math.max(0, x(b) - x(a) - 1)).attr("height", rowH)
          .attr("fill", bands[j].color).attr("rx", 2)
          .on("mousemove", e => showTip(e, `<b>${esc(r.label)}</b> · ${esc(bands[j].label)}<br>${F(v)} · ${P(100 * v / tot)}`)).on("mouseleave", hideTip);
        if (x(b) - x(a) > 34) svg.append("text").attr("x", (x(a) + x(b)) / 2).attr("y", y0 + rowH / 2 + 4).attr("text-anchor", "middle").attr("font-size", 11).attr("fill", bands[j].ink || "#fff").attr("pointer-events", "none").text(Math.round(100 * v / tot) + "%");
      });
    });
  }
  const legend = bands => `<div class="legend" style="gap:14px;flex-wrap:wrap;margin:0 0 8px">${bands.map(b => `<span class="key"><i style="background:${b.color}"></i>${esc(b.label)}</span>`).join("")}</div>`;

  // Horizontal meters for categories.
  function hbars(el, items, total) {
    if (!items.length) { el.innerHTML = '<p class="empty">No data yet.</p>'; return; }
    const max = d3.max(items, d => d.count) || 1;
    el.innerHTML = `<div class="meter">${items.map(d => `
      <div class="lbl">${esc(d.label)}</div>
      <div class="bar"><i style="width:${100 * d.count / max}%"></i></div>
      <div class="val">${F(d.count)}${total ? `<small>${P(share(d.count, total))}</small>` : ""}</div>`).join("")}</div>`;
  }

  function render(s) {
    const I = s.insights, host = $("ins-body");
    if (!I) {
      host.innerHTML = `<section><h2>Waiting for the first refresh</h2><p class="hint">This tab fills in after the collector next runs with the <code>insights:</code> block in config.yml. Run <b>Actions → Update house file stats</b> to populate it now.</p></section>`;
      return;
    }
    const cov = I.coverage, L = I.lead_time, M = I.membership, st = L.stats || {};
    const pal = [cssVar("--seq-700"), cssVar("--seq-550"), cssVar("--seq-400"), cssVar("--seq-250"), cssVar("--seq-100")];
    const today = I.today;

    $("ins-kpis").innerHTML = [
      tile("Upcoming visits on file", F(cov.visit_upcoming), `${F(cov.visit_next_30)} in the next 30 days`),
      tile("Median booking lead time", st.median != null ? `${st.median} days` : "—", st.n ? `middle half: ${st.p25}–${st.p75} days` : ""),
      tile("Booked a week or less ahead", P(share(st.within_7, st.n)), st.n ? `${P(share(st.within_30, st.n))} within 30 days` : ""),
      tile("Active members", F(M.active), `${F(M.contacts_with_member_data)} contacts carry member data`),
      tile("Members expiring in 90 days", F((M.expiration_buckets.counts || []).slice(3, 6).reduce((a, b) => a + b, 0)), "active or not"),
    ].join("");

    // --- Lead time
    vbars($("ins-lead"), L.buckets.map((b, i) => ({ key: String(i), label: b === "Same day" ? "Same day" : b.replace(" days", "d").replace(" day", "d"), y: L.hist[i] })), {
      every: 1, aria: "Days between purchase and visit",
      tip: d => `<b>${esc(L.buckets[+d.key])}</b> ahead<br>${F(d.y)} · ${P(share(d.y, st.n))}`,
    });
    const reg = L.by_region, regName = { home: `In ${I.home_state}`, elsewhere: `Outside ${I.home_state}`, unknown: "State unknown" };
    $("ins-region").innerHTML = `<table><thead><tr><th>Where they live</th><th class="num">Bookings</th><th class="num">Median</th><th class="num">Middle half</th><th class="num">≤ 7 days</th><th class="num">≥ 31 days</th></tr></thead><tbody>${
      ["home", "elsewhere", "unknown"].filter(k => reg[k] && reg[k].stats).map(k => { const r = reg[k].stats, h = reg[k].hist; const far = h.slice(6).reduce((a, b) => a + b, 0);
        return `<tr><td>${regName[k]}</td><td class="num">${F(r.n)}</td><td class="num">${r.median} days</td><td class="num">${r.p25}–${r.p75} days</td><td class="num">${P(share(r.within_7, r.n))}</td><td class="num">${P(share(far, r.n))}</td></tr>`; }).join("")}</tbody></table>`;
    const bands = [
      { label: "Same day–3 days", idx: [0, 1, 2], color: pal[0] }, { label: "4–14 days", idx: [3, 4], color: pal[1] },
      { label: "15–30 days", idx: [5], color: pal[2] }, { label: "31–90 days", idx: [6, 7], color: pal[3], ink: cssVar("--ink") },
      { label: "91+ days", idx: [8, 9], color: pal[4], ink: cssVar("--ink") },
    ];
    $("ins-lead-month-legend").innerHTML = legend(bands);
    stacked($("ins-lead-month"), L.by_visit_month.filter(r => d3.sum(r.hist) >= (I.min_cell || 3)).slice(-12).map(r => ({ key: r.month, label: monthFmt(r.month), parts: bands.map(b => d3.sum(b.idx, i => r.hist[i])) })), bands, { aria: "Lead time mix by visit month" });

    // --- Visits
    const up = I.visits.upcoming_by_day;
    vbars($("ins-upcoming"), up.map(d => ({ key: d.key, label: dayFmt(d.key), y: d.count })), {
      pad: 0.1, maxBar: 8, w: 1100, h: 260, aria: "Upcoming visits by day",
      highlight: d => [5, 6].includes((new Date(d.key + "T12:00:00").getDay() + 6) % 7),
      tip: d => `<b>${d3.timeFormat("%a, %b %-d")(d3.timeParse("%Y-%m-%d")(d.key))}</b> · ${F(d.y)} contacts visiting`,
    });
    vbars($("ins-visit-dow"), I.weekdays.map((w, i) => ({ key: w, label: w, y: I.visits.by_weekday[i] })), { every: 1, aria: "Visits by weekday", tip: d => `<b>${d.label}</b> · ${F(d.y)} next visits` });
    vbars($("ins-visit-month"), I.visits.by_month.slice(-18).map(d => ({ key: d.key, label: monthFmt(d.key), y: d.count })), {
      aria: "Next visit by month", highlight: d => d.key === today.slice(0, 7), tip: d => `<b>${monthFmt(d.key)}</b> · ${F(d.y)} contacts`,
    });

    // --- Purchases
    vbars($("ins-purchase-month"), I.purchases.by_month.slice(-18).map(d => ({ key: d.key, label: monthFmt(d.key), y: d.count })), { aria: "Last purchase by month", tip: d => `<b>${monthFmt(d.key)}</b> · ${F(d.y)} contacts whose latest order was this month` });
    vbars($("ins-purchase-dow"), I.weekdays.map((w, i) => ({ key: w, label: w, y: I.purchases.by_weekday[i] })), { every: 1, aria: "Purchases by weekday", tip: d => `<b>${d.label}</b> · ${F(d.y)} latest orders` });
    hbars($("ins-recency"), I.purchases.recency.buckets.map((b, i) => ({ label: b, count: I.purchases.recency.counts[i] })), cov.has_purchase);
    hbars($("ins-tickets"), I.ticket_types, d3.sum(I.ticket_types, d => d.count));

    // --- Membership
    hbars($("ins-levels"), M.levels_active, M.active);
    const exp = M.expiration_by_month_active;
    const peak = exp.length ? exp.reduce((a, b) => (b.count > a.count ? b : a)) : null;
    vbars($("ins-exp-month"), exp.map(d => ({ key: d.key, label: monthFmt(d.key), y: d.count })), {
      aria: "Active memberships by expiration month", highlight: d => peak && d.key === peak.key,
      tip: d => `<b>${monthFmt(d.key)}</b> · ${F(d.y)} active memberships expire`,
    });
    $("ins-exp-note").textContent = peak ? `${F(peak.count)} of ${F(M.active)} active memberships (${P(share(peak.count, M.active))}) expire in ${d3.timeFormat("%B %Y")(d3.timeParse("%Y-%m")(peak.key))}.` : "";
    hbars($("ins-exp-buckets"), M.expiration_buckets.buckets.map((b, i) => ({ label: b, count: M.expiration_buckets.counts[i] })).filter(d => d.count), M.has_expiration);

    const lvls = Object.keys(M.level_by_expiration_month || {}), months = [...new Set(lvls.flatMap(l => Object.keys(M.level_by_expiration_month[l])))].sort();
    $("ins-level-exp").innerHTML = lvls.length ? `<table><thead><tr><th>Level</th>${months.map(m => `<th class="num">${monthFmt(m)}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>${
      lvls.sort((a, b) => d3.sum(Object.values(M.level_by_expiration_month[b])) - d3.sum(Object.values(M.level_by_expiration_month[a]))).map(l => { const r = M.level_by_expiration_month[l];
        return `<tr><td>${esc(l)}</td>${months.map(m => `<td class="num">${r[m] ? F(r[m]) : ""}</td>`).join("")}<td class="num"><b>${F(d3.sum(Object.values(r)))}</b></td></tr>`; }).join("")}</tbody></table>` : '<p class="empty">No data yet.</p>';

    const rg = M.region || {}, rtot = d3.sum(Object.values(rg));
    const mv = M.visit || {}, mtot = d3.sum(Object.values(mv));
    $("ins-member-facts").innerHTML = [
      [`Live in ${I.home_state}`, rg.home, rtot], [`Live elsewhere`, rg.elsewhere, rtot], ["State unknown", rg.unknown, rtot],
      ["Have an upcoming visit booked", mv.upcoming, mtot], ["Visited before, nothing booked", mv.past_only, mtot], ["No visit on file", mv.none, mtot],
      ["Bought anything in the last year", M.purchased_last_365, M.active],
    ].map(([k, v, t]) => `<div class="kv"><span>${k}</span><span>${F(v || 0)} <span style="color:var(--muted)">· ${P(share(v || 0, t))}</span></span></div>`).join("");
    hbars($("ins-member-sources"), M.sources.map(d => ({ label: d.label, count: d.count })), M.active);

    const checks = [];
    if (cov.lead_negative) checks.push(`${F(cov.lead_negative)} contacts have a next-visit date earlier than their last purchase (an older visit kept after a newer order, or a sync gap). They are left out of lead time.`);
    if (cov.lead_outlier) checks.push(`${F(cov.lead_outlier)} bookings more than two years ahead are left out of lead time.`);
    if (M.flag_conflicts) checks.push(`${F(M.flag_conflicts)} members are flagged inactive but carry an expiration date still ahead.`);
    checks.push(`Active-member flag values seen: ${M.active_flag_values.map(v => `“${esc(v.label)}” ${F(v.count)}`).join(", ") || "none"}.`);
    $("ins-checks").innerHTML = `<ul style="margin:0;padding-left:18px">${checks.map(c => `<li>${c}</li>`).join("")}</ul>`;
    $("ins-fields").innerHTML = Object.entries(I.fields).map(([k, v]) => `<code>${esc(v)}</code>`).join(" · ");
  }

  let started = false;
  window.HFInsights = {
    start() {
      if (started) return; started = true;
      fetch("data/stats.json", { cache: "no-store" }).then(r => r.json()).then(render)
        .catch(e => { $("ins-body").innerHTML = `<p class="err" style="color:var(--crit)">Could not load data/stats.json</p>`; console.error(e); });
    },
  };
})();
