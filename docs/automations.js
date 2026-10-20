/* Shared helpers for the Automations tab and the email preview page.
   Everything here runs in the browser on public, non-personal data:
   rendered email templates plus a fake sample contact (Jane Doe). */
(function (global) {
  "use strict";

  const TAG_RE = /\[\[([^\]]+?)\]\]/g;

  const FIELD_LABELS = {
    FIRSTNAME: "First name", LASTNAME: "Last name", EMAILADDRESS: "Email address",
    COMPANYNAME: "Company", JOBTITLE: "Job title", CITY: "City", STATE: "State",
    POSTALCODE: "ZIP / postal code", PHONE: "Phone", ADDRESS1: "Street address",
    COUNTRY: "Country", BIRTHDAY: "Birthday", ANNIVERSARY: "Anniversary",
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // "FIRSTNAME OR \"Friend\"" -> {key:"FIRSTNAME", fallback:"Friend"}
  function parseTag(inner) {
    const m = inner.match(/^\s*(.+?)\s+OR\s+"([^"]*)"\s*$/i);
    return m ? { key: m[1].trim(), fallback: m[2] } : { key: inner.trim(), fallback: null };
  }

  function norm(k) { return String(k).toLowerCase().replace(/[^a-z0-9]/g, ""); }

  function lookup(sample, key) {
    if (key in sample) return sample[key];
    const n = norm(key);
    for (const k of Object.keys(sample)) if (norm(k) === n) return sample[k];
    return undefined;
  }

  // custom.acme_-_recent_order_id -> "Acme - Recent Order Id"
  function fieldLabel(key) {
    const up = key.toUpperCase();
    if (FIELD_LABELS[up]) return FIELD_LABELS[up];
    const c = key.replace(/^custom\./i, "");
    const pretty = c.replace(/_-_/g, " - ").replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase())
      .replace(/\bId\b/g, "ID");
    return pretty;
  }
  function fieldSource(key) {
    if (/^custom\./i.test(key)) return "Custom field";
    if (/^(account|org)\./i.test(key)) return "Account";
    return "Contact field";
  }

  // Every distinct merge tag in a template, in order of first appearance.
  function findTags(html) {
    const seen = new Map();
    for (const m of String(html).matchAll(TAG_RE)) {
      const t = parseTag(m[1]);
      if (/^trackingimage$/i.test(t.key)) continue;
      if (!seen.has(t.key)) seen.set(t.key, { key: t.key, fallback: t.fallback, raw: m[0], count: 0 });
      seen.get(t.key).count++;
    }
    return [...seen.values()];
  }

  // Replace merge tags with sample values. Values are HTML-escaped; inside
  // href/src attributes they are URL-encoded too (except emails stay readable).
  function fill(html, sample) {
    return String(html).replace(/(href|src)="([^"]*)"/g, (all, attr, val) => {
      const v = val.replace(TAG_RE, (_, inner) => {
        const t = parseTag(inner), s = lookup(sample, t.key);
        const out = s != null && s !== "" ? String(s) : (t.fallback || "");
        return /@/.test(out) ? out : encodeURIComponent(out);
      });
      return `${attr}="${v.replace(/"/g, "&quot;")}"`;
    }).replace(TAG_RE, (_, inner) => {
      const t = parseTag(inner);
      if (/^trackingimage$/i.test(t.key)) return "";
      const s = lookup(sample, t.key);
      return esc(s != null && s !== "" ? s : (t.fallback || ""));
    });
  }
  function fillText(text, sample) {
    return String(text || "").replace(TAG_RE, (_, inner) => {
      const t = parseTag(inner), s = lookup(sample, t.key);
      return s != null && s !== "" ? String(s) : (t.fallback || "");
    });
  }

  // Links and their query / fragment parameters, from the raw template.
  function findLinks(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const out = [], seen = new Set();
    doc.querySelectorAll("a[href]").forEach(a => {
      const href = a.getAttribute("href");
      if (!href || href === "#") return;
      const text = (a.textContent || "").replace(/\s+/g, " ").trim() || (a.querySelector("img") ? "[image]" : "");
      const keyId = href + "|" + text;
      if (seen.has(keyId)) { out.find(l => l.id === keyId).count++; return; }
      seen.add(keyId);
      let base = href, params = [];
      const qi = href.search(/[?#]/);
      if (qi >= 0 && !/^mailto:/i.test(href)) {
        base = href.slice(0, qi);
        const rest = href.slice(qi);
        rest.split(/(?=[?#])/).forEach(part => {
          const kind = part[0] === "?" ? "query" : "fragment";
          part.slice(1).split("&").filter(Boolean).forEach(kv => {
            const i = kv.indexOf("=");
            params.push({ kind, name: i < 0 ? kv : kv.slice(0, i), value: i < 0 ? "" : kv.slice(i + 1) });
          });
        });
      }
      out.push({ id: keyId, text, href, base, params, count: 1, mailto: /^mailto:/i.test(href) });
    });
    return out;
  }

  function dayLabel(n) {
    if (n == null) return "—";
    if (n === 0) return "Visit day";
    return (n < 0 ? "T−" : "T+") + Math.abs(n) + (Math.abs(n) === 1 ? " day" : " days");
  }

  async function loadData() {
    const r = await fetch("data/automations.json", { cache: "no-store" });
    if (!r.ok) throw new Error("automations.json " + r.status);
    return r.json();
  }
  const htmlCache = new Map();
  async function loadEmail(path) {
    if (!htmlCache.has(path)) htmlCache.set(path, fetch(path, { cache: "no-store" }).then(r => r.ok ? r.text() : ""));
    return htmlCache.get(path);
  }
  function allEmails(data) {
    const out = [];
    data.flows.forEach(f => f.paths.forEach(p => p.emails.forEach(e => out.push({ flow: f, path: p, email: e }))));
    return out;
  }

  global.HFAuto = { esc, parseTag, lookup, fieldLabel, fieldSource, findTags, fill, fillText, findLinks, dayLabel, loadData, loadEmail, allEmails };
})(window);
