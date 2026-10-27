// Transactional (SendGrid) confirmations: load the template snapshot and render it
// with the FAKE sample orders from config.yml. Needs Handlebars (loaded from cdnjs).
(function (global) {
  "use strict";

  async function loadData() {
    const r = await fetch("data/transactional.json", { cache: "no-store" });
    if (!r.ok) throw new Error("transactional.json " + r.status);
    return r.json();
  }

  const cache = new Map();
  function loadTemplate(path) {
    if (!cache.has(path)) cache.set(path, fetch(path, { cache: "no-store" }).then(r => (r.ok ? r.text() : "")));
    return cache.get(path);
  }

  // SendGrid's Handlebars accepts a few helpers Handlebars.js doesn't ship with.
  let helpersReady = false;
  function helpers() {
    if (helpersReady || !global.Handlebars) return;
    const H = global.Handlebars;
    const eq = (a, b) => a == b; // eslint-disable-line eqeqeq
    H.registerHelper("equals", function (a, b, opts) { return eq(a, b) ? opts.fn(this) : opts.inverse(this); });
    H.registerHelper("notEquals", function (a, b, opts) { return !eq(a, b) ? opts.fn(this) : opts.inverse(this); });
    H.registerHelper("greaterThan", function (a, b, opts) { return Number(a) > Number(b) ? opts.fn(this) : opts.inverse(this); });
    H.registerHelper("lessThan", function (a, b, opts) { return Number(a) < Number(b) ? opts.fn(this) : opts.inverse(this); });
    H.registerHelper("and", function () { const a = [...arguments], o = a.pop(); return a.every(Boolean) ? o.fn(this) : o.inverse(this); });
    H.registerHelper("or", function () { const a = [...arguments], o = a.pop(); return a.some(Boolean) ? o.fn(this) : o.inverse(this); });
    H.registerHelper("length", v => (v && v.length) || 0);
    H.registerHelper("formatDate", v => v);
    H.registerHelper("insert", (v, d) => (v == null || v === "" ? (d && d.hash && d.hash.default) || "" : v));
    helpersReady = true;
  }

  function sample(data, key) {
    const s = (data.samples || {})[key] || {};
    return s;
  }

  function render(tpl, ctx) {
    helpers();
    if (!global.Handlebars) return "<p style='font:14px sans-serif;padding:20px'>Preview needs Handlebars, which did not load.</p>";
    try {
      return global.Handlebars.compile(tpl, { noEscape: false, strict: false })(ctx);
    } catch (e) {
      return `<p style="font:14px sans-serif;padding:20px;color:#b00">Could not render this template: ${String(e.message).replace(/</g, "&lt;")}</p>`;
    }
  }

  async function renderVariant(data, t, key) {
    if (!t.html) return "";
    return render(await loadTemplate(t.html), sample(data, key));
  }

  function subject(t, key, data) {
    return t.subject ? render(t.subject, sample(data, key)) : "";
  }

  global.HFTrans = { loadData, loadTemplate, render, renderVariant, subject, sample };
})(window);
