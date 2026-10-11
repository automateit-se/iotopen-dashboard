// Status per function: 0 = OK, 1 = Warning, 2 = Critical (same levels as IoT Open's metric-monitor).
//
// Sources, in priority order:
//   1. meta dashboard.status (+ dashboard.status_text) – a fixed status, created in the widget editor or by
//      something else (a service, a person in Lynx) and then changed from IoT Open.
//   2. limits evaluated live against the latest value: meta dashboard.limits, e.g. "-w<18,>21 -c<16,>22"
//      -w = warning, -c = critical; conditions are comma separated and any match counts.
//      Operators: < <= > >= = != (no operator = equal). Critical wins over warning.
// No source = no status (nothing is shown). metric_monitor.status is handled separately (staleOf, below).

export const STATUS_META = {
  status: 'dashboard.status',
  text: 'dashboard.status_text',
  limits: 'dashboard.limits',
};

export const STATUS_TEXT = ['OK', 'Warning', 'Critical'];

const COND = /^(<=|>=|!=|==|<|>|=)?\s*(-?\d+(?:[.,]\d+)?)$/;

/** Parses "-w<18,>21 -c<16,>22" into { warn: [...], crit: [...] }, or null with error text. */
export function parseLimits(src) {
  const out = { warn: [], crit: [] };
  const s = String(src || '').trim();
  if (!s) return { limits: null, error: '' };
  const parts = s.split(/\s+(?=-[wc])/);
  for (const part of parts) {
    const m = /^-([wc])\s*(.+)$/.exec(part.trim());
    if (!m) return { limits: null, error: `Okänd del "${part}". Börja med -w eller -c.` };
    for (const raw of m[2].split(',')) {
      const c = COND.exec(raw.trim());
      if (!c) return { limits: null, error: `Kan inte tolka villkoret "${raw.trim()}".` };
      (m[1] === 'w' ? out.warn : out.crit).push({ op: c[1] || '=', v: Number(c[2].replace(',', '.')) });
    }
  }
  return { limits: out, error: '' };
}

const test = ({ op, v }, x) =>
  op === '<' ? x < v : op === '<=' ? x <= v : op === '>' ? x > v : op === '>=' ? x >= v : op === '!=' ? x !== v : x === v;

export const limitsOf = (fn) => fn?.meta?.[STATUS_META.limits] || '';

/** { level: 0|1|2, text, source } or null when the function has no status. */
export function statusOf(fn, value) {
  const m = fn?.meta || {};
  const explicit = m[STATUS_META.status];
  if (explicit !== undefined && explicit !== '' && Number.isFinite(Number(explicit))) {
    const level = Math.max(0, Math.min(2, Math.round(Number(explicit))));
    return { level, text: m[STATUS_META.text] || STATUS_TEXT[level], source: STATUS_META.status };
  }
  const src = limitsOf(fn);
  if (src) {
    const { limits } = parseLimits(src);
    const x = Number(value);
    if (limits && value !== undefined && value !== null && value !== '' && Number.isFinite(x)) {
      const level = limits.crit.some((c) => test(c, x)) ? 2 : limits.warn.some((c) => test(c, x)) ? 1 : 0;
      return { level, text: STATUS_TEXT[level], source: 'limits', limits: src };
    }
  }
  return null;
}

// ---- silent functions (IoT Open metric-monitor) --------------------------------------------------
// metric-monitor is a server job: for objects with metric_monitor.max_silent_time it sets
// metric_monitor.status (0 = OK, 1/2 = silent too long) and metric_monitor.status_text.
// A silent function's last value may no longer be true, so it is shown greyed out with its name struck
// through – not coloured as Warning/Critical. The device's status applies to all its functions.

const mmLevel = (meta) => {
  const v = meta?.['metric_monitor.status'];
  return v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : 0;
};

/** { level, text, source: 'function'|'device' } when the function (or its device) is silent, else null. */
export function staleOf(fn, raw) {
  if (!fn) return null;
  const own = mmLevel(fn.meta);
  if (own > 0) return { level: own, text: fn.meta['metric_monitor.status_text'] || 'Har inte rapporterat inom förväntad tid', source: 'function' };
  const dev = raw?.devices?.find((d) => String(d.id) === String(fn.meta?.device_id));
  const dl = mmLevel(dev?.meta);
  if (dl > 0) return { level: dl, text: dev.meta['metric_monitor.status_text'] || 'Enheten har inte rapporterat inom förväntad tid', source: 'device' };
  return null;
}

/** Same for a device object itself. */
export function staleDevice(dev) {
  const l = mmLevel(dev?.meta);
  return l > 0 ? { level: l, text: dev.meta['metric_monitor.status_text'] || 'Har inte rapporterat inom förväntad tid', source: 'device' } : null;
}

/** Worst status among several functions (with their current values), or null. */
export function worstStatus(entries) {
  let worst = null;
  for (const [fn, value] of entries) {
    const s = statusOf(fn, value);
    if (s && (!worst || s.level > worst.level)) worst = { ...s, fn };
  }
  return worst;
}

/** Props for an element of a silent function: class + tooltip. */
export const staleProps = (fn, raw) => {
  const s = staleOf(fn, raw);
  return s ? { className: 'stale', title: `Tyst: ${s.text}` } : {};
};
