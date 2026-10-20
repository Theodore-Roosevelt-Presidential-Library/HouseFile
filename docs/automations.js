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

  // Constant Contact system tags: links and pixels CC fills at send time.
  const SYSTEM = new Set(["trackingimage", "unsubscribe", "updatelink", "viewaswebpage", "forwardtoafriend"]);
  const isSystem = k => SYSTEM.has(String(k).toLowerCase());

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // "FIRSTNAME OR \"Friend\"" -> {key:"FIRSTNAME", fallback:"Friend"}
  function parseTag(inner) {
    inner = String(inner).replace(/&quot;/g, '"').replace(/&#39;/g, "'");
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

  const ACCOUNT_LABELS = { organizationname: "Organization name", addressline1: "Street address", city: "City", usstate: "State", postalcode: "ZIP code" };

  // custom.acme_-_recent_order_id -> "Acme - Recent Order ID"
  function fieldLabel(key) {
    const up = key.toUpperCase();
    if (FIELD_LABELS[up]) return FIELD_LABELS[up];
    const acct = key.match(/^account\.(.+)$/i);
    if (acct) return "Account " + (ACCOUNT_LABELS[acct[1].toLowerCase()] || acct[1]).toLowerCase();
    const c = key.replace(/^custom\./i, "");
    const pretty = c.replace(/_-_/g, " - ").replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase())
      .replace(/\bId\b/g, "ID");
    return pretty;
  }
  function fieldSource(key) {
    if (/^custom\./i.test(key)) return "Custom field";
    if (/^(account|org)\./i.test(key)) return "Account (filled by Constant Contact)";
    return "Contact field";
  }

  // Every distinct merge tag in a template, in order of first appearance.
  function findTags(html) {
    const seen = new Map();
    for (const m of String(html).matchAll(TAG_RE)) {
      const t = parseTag(m[1]);
      if (isSystem(t.key)) continue;
      if (!seen.has(t.key)) seen.set(t.key, { key: t.key, fallback: t.fallback, raw: m[0], count: 0 });
      seen.get(t.key).count++;
    }
    return [...seen.values()];
  }

  // Conditional rows: a preview of Constant Contact dynamic content. In Constant Contact
  // each row gets a display condition "<field> is <value>" (several values = ANY rule),
  // plus a default row for contacts who match none. Proposal HTML marks them with
  // comments, which every email client ignores:
  //   <!--cc:if group="g1" tag="custom.acme_-_membership_level" field="Acme - Membership Level" label="Membership level" is="Dual|Family"-->…<!--cc:end-->
  //   <!--cc:else group="g1" tag="…" field="…" label="…"-->…<!--cc:end-->
  const COND_RE = /<!--cc:(if|else)\s+([^>]*?)-->([\s\S]*?)<!--cc:end-->/g;
  function condAttrs(s) { const o = {}; String(s).replace(/(\w+)="([^"]*)"/g, (_, k, v) => (o[k] = v)); return o; }
  function condValue(sample, tag) { const v = lookup(sample || {}, tag); return v == null ? "" : String(v).trim(); }
  // One entry per field the email switches on, with every value it has a row for.
  function findConditions(html) {
    const byTag = new Map();
    for (const m of String(html).matchAll(COND_RE)) {
      const a = condAttrs(m[2]);
      if (!byTag.has(a.tag)) byTag.set(a.tag, { tag: a.tag, field: a.field, label: a.label || a.field, values: [], groups: new Set(), hasElse: false, other: a.other });
      const c = byTag.get(a.tag);
      c.groups.add(a.group);
      if (m[1] === "else") c.hasElse = true;
      else (a.is || "").split("|").forEach(v => { if (v && !c.values.includes(v)) c.values.push(v); });
      if (a.other) c.other = a.other;
    }
    return [...byTag.values()].map(c => Object.assign(c, { groups: c.groups.size }));
  }
  function applyConditions(html, sample) {
    const hit = new Set();
    for (const m of String(html).matchAll(COND_RE)) {
      const a = condAttrs(m[2]);
      if (m[1] === "if" && (a.is || "").split("|").includes(condValue(sample, a.tag))) hit.add(a.group);
    }
    return String(html).replace(COND_RE, (_, kind, at, body) => {
      const a = condAttrs(at);
      if (kind === "if") return (a.is || "").split("|").includes(condValue(sample, a.tag)) ? body : "";
      return hit.has(a.group) ? "" : body;
    });
  }

  // Replace merge tags with sample values. Values are HTML-escaped; inside
  // href/src attributes they are URL-encoded too (except emails stay readable).
  function fill(html, sample) {
    html = applyConditions(html, sample);
    return String(html).replace(/(href|src)="([^"]*)"/g, (all, attr, val) => {
      const v = val.replace(TAG_RE, (_, inner) => {
        const t = parseTag(inner);
        if (isSystem(t.key)) return "#";
        const s = lookup(sample, t.key);
        const out = s != null && s !== "" ? String(s) : (t.fallback || "");
        return /@/.test(out) ? out : encodeURIComponent(out);
      });
      return `${attr}="${v.replace(/"/g, "&quot;")}"`;
    }).replace(TAG_RE, (_, inner) => {
      const t = parseTag(inner);
      if (isSystem(t.key)) return "";
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
    data.flows.forEach(f => groupByTrigger(f.paths).forEach(g => g.paths.forEach(p => p.emails.forEach(e => out.push({ flow: f, path: p, email: e })))));
    return out;
  }

  // Paths in a flow, grouped by the date field that triggers them (a visit date and a
  // membership expiration date can't share one timeline), each group in send order.
  function groupByTrigger(paths) {
    const groups = [];
    paths.forEach(p => {
      const field = p.trigger.field || p.trigger.label || "Other";
      let g = groups.find(x => x.field === field);
      if (!g) groups.push(g = { field, paths: [] });
      g.paths.push(p);
    });
    groups.forEach(g => g.paths.sort((a, b) => (a.trigger.offset_days ?? 9999) - (b.trigger.offset_days ?? 9999)));
    return groups;
  }
  function anchorWord(field) {
    if (/visit/i.test(field || "")) return "Visit";
    if (/expir/i.test(field || "")) return "Expires";
    return "T";
  }

  global.HFAuto = { findConditions, applyConditions, groupByTrigger, anchorWord, isSystem, esc, parseTag, lookup, fieldLabel, fieldSource, findTags, fill, fillText, findLinks, dayLabel, loadData, loadEmail, allEmails };
})(window);
