import { useEffect, useMemo, useRef, useState } from 'react';
import { normTopic } from '../../api/lynx.js';
import { formatAge, formatValue } from '../../lib/format.js';
import { fnName, rangeOf, safeColor, writeTopic } from '../../lib/dashboard.js';
import { loadHistory } from '../../lib/history.js';
import { actionText, dialValueAt, modeText, setpointSegments, stepSetpoint, thermostatFunctions, thermostatModes, zoneFor, zonesOf } from '../../lib/thermostat.js';
import { Icon } from '../icons.jsx';

const SEND_DELAY = 800; // ms after the last − / + press, so a few presses give one command
const PENDING_TIMEOUT = 8000; // back to the reported setpoint if the thermostat does not answer

/** A text value (mode, action): the value when it is text, else the msg. IoT Open's status API can return 0 for text. */
const textOf = (v) => {
  if (!v) return '';
  const s = typeof v.value === 'string' && !Number.isFinite(Number(v.value)) ? v.value : v.msg;
  return String(s || '').trim();
};

const num = (v) => (v && v.value !== '' && v.value !== null && Number.isFinite(Number(v.value)) ? Number(v.value) : NaN);

// ---- dial (layout view "dial"): a 270° ring from min to max, filled up to the set point in its zone colour ----
const DIAL = { size: 240, r: 96, width: 16, start: 135, sweep: 270 };
const polar = (deg, r) => {
  const a = (deg * Math.PI) / 180;
  return [DIAL.size / 2 + r * Math.cos(a), DIAL.size / 2 + r * Math.sin(a)];
};
const arcPath = (a0, a1, r = DIAL.r) => {
  const [x0, y0] = polar(a0, r);
  const [x1, y1] = polar(a1, r);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
};

function Dial({ value, current, range, color, zone, off, disabled, label, currentFn, valueText, onDrag, onRelease, onStep }) {
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);
  const angle = (v) => DIAL.start + ((Math.min(range.max, Math.max(range.min, v)) - range.min) / (range.max - range.min)) * DIAL.sweep;
  const at = (e) => {
    const b = ref.current.getBoundingClientRect();
    const k = DIAL.size / b.width;
    return dialValueAt((e.clientX - b.left) * k - DIAL.size / 2, (e.clientY - b.top) * k - DIAL.size / 2, range, DIAL.start, DIAL.sweep);
  };
  const has = Number.isFinite(value);
  const [kx, ky] = polar(angle(has ? value : range.min), DIAL.r);
  const a = Number.isFinite(current) ? angle(current) : null;
  return (
    <div className={`thermo-dial ${dragging ? 'dragging' : ''}`}>
      <svg
        ref={ref}
        viewBox={`0 0 ${DIAL.size} ${DIAL.size}`}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={range.min}
        aria-valuemax={range.max}
        aria-valuenow={has ? value : undefined}
        aria-valuetext={valueText}
        aria-disabled={disabled}
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          onDrag(at(e));
        }}
        onPointerMove={(e) => dragging && onDrag(at(e))}
        onPointerUp={() => {
          if (!dragging) return;
          setDragging(false);
          onRelease();
        }}
        onPointerCancel={() => {
          if (!dragging) return;
          setDragging(false);
          onRelease();
        }}
        onKeyDown={(e) => {
          const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
          if (d && !disabled) {
            e.preventDefault();
            onStep(d);
          }
        }}
      >
        <path d={arcPath(DIAL.start, DIAL.start + DIAL.sweep)} className="thermo-dial-track" strokeWidth={DIAL.width} />
        {has && !off && <path d={arcPath(DIAL.start, Math.max(DIAL.start + 0.5, angle(value)))} stroke={color} strokeWidth={DIAL.width} className="thermo-dial-fill" />}
        {a !== null && (
          // the room temperature: a short tick inside the ring
          <line x1={polar(a, DIAL.r - DIAL.width / 2 - 3)[0]} y1={polar(a, DIAL.r - DIAL.width / 2 - 3)[1]} x2={polar(a, DIAL.r - DIAL.width / 2 - 12)[0]} y2={polar(a, DIAL.r - DIAL.width / 2 - 12)[1]} className="thermo-dial-now" />
        )}
        {has && <circle cx={kx} cy={ky} r={DIAL.width * 0.82} fill={off ? 'var(--muted)' : color} className="thermo-dial-knob" />}
      </svg>
      <div className="thermo-dial-center">
        <span className="thermo-dial-set" style={{ color: off ? undefined : color }}>
          {off ? 'Av' : valueText}
        </span>
        {!off && zone && <span className="thermo-dial-zone" style={{ color }}>{zone}</span>}
        {currentFn && <span className="muted small">Nu {Number.isFinite(current) ? formatValue(currentFn, current) : '–'}</span>}
      </div>
    </div>
  );
}

// ---- Minigraf (layout "spark"): the temperature as a line in a fixed colour, the set point as a dashed step line
// in its zone colours -----------------------------------------------------------------------------------------
function ThermoGraph({ t, ctx, iid, hours, tempColor, zones, current, target }) {
  const curTopic = t.current ? normTopic(t.current.meta?.topic_read) : '';
  const tgtTopic = t.target ? normTopic(t.target.meta?.topic_read) : '';
  const [data, setData] = useState(null); // { temp: [], sp: [] }
  const [err, setErr] = useState('');
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    if (!curTopic && !tgtTopic) return;
    let alive = true;
    setData(null);
    setErr('');
    const to = Date.now() / 1000;
    const from = to - hours * 3600;
    const load = (topic, method) => (topic ? loadHistory(iid, ctx.inst?.client_id, [topic], from, to, { mode: 'numeric', method }).then((h) => h.byTopic.get(topic) || []) : Promise.resolve([]));
    // the set point changes in steps: the last value per interval keeps them sharp
    Promise.all([load(curTopic, 'avg'), load(tgtTopic, 'last')])
      .then(([temp, sp]) => alive && setData({ temp, sp }))
      .catch((e) => alive && setErr(e.status === 403 ? 'Saknar behörighet till loggen' : 'Kunde inte läsa historiken'));
    const off = ctx.onLive((e) => {
      if ((e.topic !== curTopic && e.topic !== tgtTopic) || !Number.isFinite(Number(e.value))) return;
      const key = e.topic === curTopic ? 'temp' : 'sp';
      const cut = Date.now() / 1000 - hours * 3600;
      setNow(Date.now() / 1000);
      setData((d) => (d ? { ...d, [key]: [...d[key].filter((x) => x.ts >= cut || key === 'sp'), { ts: e.timestamp, value: Number(e.value) }] } : d));
    });
    const tick = setInterval(() => setNow(Date.now() / 1000), 60000);
    return () => {
      alive = false;
      off();
      clearInterval(tick);
    };
  }, [iid, curTopic, tgtTopic, hours, ctx.onLive, ctx.inst?.client_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const from = now - hours * 3600;
  const view = useMemo(() => {
    if (!data) return null;
    // both lines run to now: the latest values hold until the next ones
    const temp = data.temp.filter((x) => x.ts >= from - 1);
    if (Number.isFinite(current) && (!temp.length || temp[temp.length - 1].ts < now)) temp.push({ ts: now, value: current });
    let sp = data.sp;
    if (!sp.length && Number.isFinite(target)) sp = [{ ts: from, value: target }];
    else if (sp.length && sp[0].ts > from) sp = [{ ts: from, value: sp[0].value }, ...sp];
    const vals = [...temp.map((x) => x.value), ...sp.filter((x) => x.ts >= from).map((x) => x.value)].filter(Number.isFinite);
    if (!vals.length) return null;
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const pad = Math.max(0.5, (hi - lo) * 0.1);
    lo -= pad;
    hi += pad;
    // the temperature uses the same y range as the set point, so the two lines can be compared
    const X = (ts) => (((ts - from) / (now - from)) * 100).toFixed(2);
    const Y = (v) => (40 - ((v - lo) / (hi - lo)) * 40).toFixed(2);
    const pts = temp.filter((x) => x.ts >= from && Number.isFinite(x.value));
    let tp = null;
    if (pts.length >= 2) {
      const line = pts.map((x, i) => `${i ? 'L' : 'M'}${X(x.ts)},${Y(x.value)}`).join(' ');
      tp = { line, area: `${line} L${X(pts[pts.length - 1].ts)},40 L${X(pts[0].ts)},40 Z` };
    }
    return { tp, segs: setpointSegments(sp, from, now, lo, hi, zones, 100, 40), lo, hi };
  }, [data, from, now, current, target, zones]);

  if (err) return <div className="thermo-graph muted small">{err}</div>;
  return (
    <div className="thermo-graph">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
        {view?.tp && (
          <>
            <path d={view.tp.area} fill={tempColor} opacity="0.1" />
            <path d={view.tp.line} fill="none" stroke={tempColor} className="thermo-graph-temp" vectorEffect="non-scaling-stroke" />
          </>
        )}
        {view?.segs.map((s, i) => (
          <path key={i} d={s.d} fill="none" stroke={s.color} className="thermo-graph-sp" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="thermo-graph-legend small muted">
        {t.current && (
          <span>
            <svg viewBox="0 0 20 6" aria-hidden="true">
              <path d="M1,3 H19" stroke={tempColor} strokeWidth="2" />
            </svg>
            Temperatur
          </span>
        )}
        {t.target && (
          <span>
            <svg viewBox="0 0 20 6" aria-hidden="true">
              <path d="M1,3 H19" stroke={zoneFor(Number.isFinite(target) ? target : 20, zones).color} strokeWidth="2.4" strokeDasharray="4 3" />
            </svg>
            Börvärde
          </span>
        )}
        <span className="grow" />
        {view && (
          <span className="thermo-graph-range">
            {formatValue(t.current || t.target, Number(view.lo.toFixed(1)))} – {formatValue(t.current || t.target, Number(view.hi.toFixed(1)))}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Thermostat: current temperature, setpoint with − / + (or a dial), mode buttons and what it is doing (heating,
 * idle …), optionally with a Minigraf. The set point takes the colour of its zone (layout "zones").
 * Only the parts whose functions the device has are shown.
 */
export function ThermostatWidget({ w, ctx, iid }) {
  const t = thermostatFunctions(ctx.raw, w.obj.id);
  const curV = t.current ? ctx.valueOf(t.current) : null;
  const tgtV = t.target ? ctx.valueOf(t.target) : null;
  const modeV = t.mode ? ctx.valueOf(t.mode) : null;
  const actV = t.action ? ctx.valueOf(t.action) : null;
  // without min/max 5-30, without step 0.5 (rangeOf defaults the step to 1, too coarse for a thermostat)
  const r = t.target && rangeOf(t.target);
  const range = r ? { ...r, step: Number(t.target.meta?.step) > 0 ? r.step : 0.5 } : { min: 5, max: 30, step: 0.5 };
  const tgtWrite = t.target ? writeTopic(t.target) : '';
  const modeWrite = t.mode ? writeTopic(t.mode) : '';
  const [draft, setDraft] = useState(null); // setpoint shown while pressing / waiting for the thermostat
  const [pendingMode, setPendingMode] = useState(null);
  const [err, setErr] = useState('');
  const timer = useRef(null);
  const reported = num(tgtV);

  useEffect(() => setDraft(null), [tgtV?.timestamp, tgtV?.value]);
  useEffect(() => setPendingMode(null), [modeV?.timestamp, modeV?.value, modeV?.msg]);
  useEffect(() => {
    if (pendingMode === null) return;
    const id = setTimeout(() => setPendingMode(null), PENDING_TIMEOUT);
    return () => clearTimeout(id);
  }, [pendingMode]);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!t.target && !t.mode) return <div className="muted small">Enheten har ingen funktion för börvärde eller läge (topic …/target eller …/mode).</div>;

  const mode = pendingMode ?? textOf(modeV);
  const off = mode.toLowerCase() === 'off';
  const modes = thermostatModes(t.mode);
  if (mode && !modes.includes(mode.toLowerCase()) && !modes.includes(mode)) modes.push(mode);
  const action = textOf(actV);
  const shown = draft ?? reported;
  const unitFn = t.target || t.current;
  const lastTs = Math.max(curV?.timestamp || 0, tgtV?.timestamp || 0, modeV?.timestamp || 0);
  const zones = zonesOf(w.layout.zones);
  const zone = Number.isFinite(shown) ? zoneFor(shown, zones) : null;
  const setColor = off || !zone ? undefined : zone.color;
  const dial = w.layout.view === 'dial' && !!t.target;
  const h = Number(w.layout.h) || 1;
  const graph = !!w.layout.spark && (t.current || t.target) && h >= (dial ? 4 : 3);
  const tempColor = safeColor(w.layout.tempColor) || 'var(--tile-color, var(--data))';

  const press = (steps) => {
    if (!tgtWrite) return setErr('Börvärdet saknar topic_write');
    const next = stepSetpoint(Number.isFinite(shown) ? shown : NaN, steps, range);
    setDraft(next);
    setErr('');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!ctx.publish(tgtWrite, next)) {
        setErr('Ingen MQTT-anslutning');
        setDraft(null);
        return;
      }
      // waiting for the thermostat; the reported value replaces the draft, or the timeout does
      timer.current = setTimeout(() => setDraft(null), PENDING_TIMEOUT);
    }, SEND_DELAY);
  };
  // the dial: dragging shows the value, releasing sends it at once
  const send = (v) => {
    clearTimeout(timer.current);
    if (!tgtWrite) return setErr('Börvärdet saknar topic_write');
    if (!ctx.publish(tgtWrite, v)) {
      setErr('Ingen MQTT-anslutning');
      setDraft(null);
      return;
    }
    setErr('');
    timer.current = setTimeout(() => setDraft(null), PENDING_TIMEOUT);
  };
  const setMode = (m) => {
    if (!modeWrite) return setErr('Läget saknar topic_write');
    if (!ctx.publish(modeWrite, m)) return setErr('Ingen MQTT-anslutning');
    setErr('');
    setPendingMode(m);
  };
  const fmt = (fn, v) => (Number.isFinite(v) ? formatValue(fn, v) : '–');

  return (
    <div className={`thermo ${off ? 'is-off' : ''} ${graph ? 'has-graph' : ''}`}>
      {dial && (
        <Dial
          value={shown}
          current={num(curV)}
          range={range}
          color={setColor}
          zone={zone?.text}
          off={off}
          disabled={!tgtWrite || off}
          label={`Börvärde för ${w.name}`}
          currentFn={t.current}
          valueText={fmt(unitFn, shown)}
          onDrag={(v) => {
            clearTimeout(timer.current);
            setDraft(v);
          }}
          onRelease={() => draft !== null && send(draft)}
          onStep={press}
        />
      )}
      {!dial && <div className="thermo-main">
        {t.current && (
          <div className="thermo-cur">
            <span className="thermo-cur-val">{fmt(t.current, num(curV))}</span>
            <span className="muted small">Nu</span>
          </div>
        )}
        {t.target && (
          <div className="thermo-set">
            <button type="button" className="media-btn" aria-label="Sänk börvärdet" disabled={!tgtWrite || off} onClick={() => press(-1)}>
              <Icon name="minus" size={18} />
            </button>
            <div className={`thermo-set-val ${draft !== null ? 'pending' : ''}`} title={zone?.text ? `${fnName(t.target)} · ${zone.text}` : fnName(t.target)}>
              <span style={{ color: setColor }}>{off ? 'Av' : fmt(unitFn, shown)}</span>
              <span className="muted small">Börvärde</span>
            </div>
            <button type="button" className="media-btn" aria-label="Höj börvärdet" disabled={!tgtWrite || off} onClick={() => press(1)}>
              <Icon name="plus" size={18} />
            </button>
          </div>
        )}
      </div>}
      {t.mode && modes.length > 0 && (
        <div className="thermo-modes seg" role="group" aria-label="Läge">
          {modes.map((m) => (
            <button key={m} type="button" className={m.toLowerCase() === mode.toLowerCase() ? 'on' : ''} aria-pressed={m.toLowerCase() === mode.toLowerCase()} disabled={!modeWrite} onClick={() => setMode(m)}>
              {modeText(m)}
            </button>
          ))}
        </div>
      )}
      {graph && <ThermoGraph t={t} ctx={ctx} iid={iid} hours={Number(w.layout.hours) || 24} tempColor={tempColor} zones={zones} current={num(curV)} target={shown} />}
      <div className="muted small thermo-status">
        {[t.mode && !modes.length && mode ? modeText(mode) : '', action ? actionText(action) : '', lastTs ? formatAge(lastTs) : ''].filter(Boolean).join(' · ')}
      </div>
      {err && <div className="err small">{err}</div>}
    </div>
  );
}
