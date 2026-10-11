import { useEffect, useState } from 'react';
import { formatValue, formatAge, isOn, onOffValues } from '../../lib/format.js';
import { fnName, writeTopic, onOffTopics, rangeOf, isBinary, isHidden } from '../../lib/dashboard.js';
import { TimelineWidget } from './Timeline.jsx';
import { MultiChartWidget } from './MultiChart.jsx';
import { statusOf, staleProps } from '../../lib/status.js';

/** CSS class for a value's status (warning/critical colour), '' when OK or none. */
export const stClass = (fn, value) => {
  const s = statusOf(fn, value);
  return s && s.level > 0 ? `st-${s.level}` : '';
};

// ---- value -------------------------------------------------------------------------------
export function ValueWidget({ w, ctx }) {
  const v = ctx.valueOf(w.obj);
  return (
    <div className="w-value">
      <div className={`big ${stClass(w.obj, v?.value)}`}>{formatValue(w.obj, v?.value)}</div>
      <div className="muted small">{formatAge(v?.timestamp)}</div>
    </div>
  );
}

// ---- status (on/off indicator) -------------------------------------------------------------
export function StatusWidget({ w, ctx }) {
  const v = ctx.valueOf(w.obj);
  const has = v && v.value !== undefined && v.value !== null;
  const on = has && isOn(w.obj, v.value);
  return (
    <div className="w-status">
      <span className={`dot ${has ? (on ? 'on' : 'off') : 'none'}`} />
      <div>
        <div className="big">{has ? formatValue(w.obj, v.value) : '–'}</div>
        <div className="muted small">{v?.msg || formatAge(v?.timestamp)}</div>
      </div>
    </div>
  );
}

// ---- switch (publishes to topic_write, or topic_write_onoff for dimmers) --------------------------
export function Toggle({ fn, ctx, compact = false }) {
  const { read, write } = onOffTopics(fn);
  const v = ctx.valueOfTopic(read);
  const on = v ? isOn(fn, v.value) : false;
  const [pending, setPending] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => setPending(null), [v?.timestamp]);
  const { on: onVal, off: offVal } = onOffValues(fn);
  const shown = pending ?? on;
  const click = () => {
    if (!write) return setErr('Funktionen saknar topic_write');
    const next = !shown;
    if (!ctx.publish(write, next ? onVal : offVal)) return setErr('Ingen MQTT-anslutning');
    setErr('');
    setPending(next);
    setTimeout(() => setPending(null), 8000); // fall back to the reported state if nothing comes back
  };
  return (
    <span className="toggle-wrap">
      <button type="button" className={`toggle ${shown ? 'on' : ''} ${pending !== null ? 'pending' : ''}`} role="switch" aria-checked={shown} aria-label={`Slå av/på ${fnName(fn)}`} onClick={click} disabled={!write} title={write ? '' : 'Saknar topic_write'}>
        <span className="knob" />
      </button>
      {!compact && err && <span className="err small">{err}</span>}
    </span>
  );
}

export function SwitchWidget({ w, ctx }) {
  const v = ctx.valueOfTopic(onOffTopics(w.obj).read);
  return (
    <div className="w-switch">
      <Toggle fn={w.obj} ctx={ctx} />
      <div>
        <div className="mid">{v ? formatValue(w.obj, v.value) : '–'}</div>
        <div className="muted small">{formatAge(v?.timestamp)}</div>
      </div>
    </div>
  );
}

// ---- number (setpoint / dimmer level, publishes to topic_write) -----------------------------------
export function NumberSet({ fn, ctx, compact = false }) {
  const v = ctx.valueOf(fn);
  const [draft, setDraft] = useState('');
  const [slide, setSlide] = useState(null);
  const [err, setErr] = useState('');
  const write = writeTopic(fn);
  const range = rangeOf(fn);
  const publish = (n) => {
    if (!write) return setErr('Funktionen saknar topic_write');
    if (!ctx.publish(write, n)) return setErr('Ingen MQTT-anslutning');
    setErr('');
    return true;
  };
  const send = (e) => {
    e.preventDefault();
    const n = Number(String(draft).replace(',', '.'));
    if (draft === '' || !Number.isFinite(n)) return setErr('Ange ett tal');
    if (publish(n)) setDraft('');
  };
  useEffect(() => setSlide(null), [v?.timestamp]);

  if (range) {
    const cur = slide ?? (Number.isFinite(Number(v?.value)) ? Number(v.value) : range.min);
    const commit = () => slide !== null && publish(slide);
    return (
      <div className={`numset ${compact ? 'compact' : ''}`}>
        {!compact && <span className="mid">{formatValue(fn, cur)}</span>}
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={cur}
          disabled={!write}
          aria-label={`Nivå för ${fnName(fn)}`}
          onChange={(e) => setSlide(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
        />
        {compact && <span className="small">{formatValue(fn, cur)}</span>}
        {!compact && err && <span className="err small">{err}</span>}
      </div>
    );
  }
  return (
    <form className={`numset ${compact ? 'compact' : ''}`} onSubmit={send}>
      {!compact && <span className="mid">{formatValue(fn, v?.value)}</span>}
      <input inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={v?.value !== undefined ? String(v.value) : ''} aria-label={`Nytt värde för ${fnName(fn)}`} disabled={!write} />
      <button type="submit" className="btn" disabled={!write}>
        Sätt
      </button>
      {!compact && err && <span className="err small">{err}</span>}
    </form>
  );
}

export function NumberWidget({ w, ctx }) {
  // a dimmer with a separate on/off topic gets its toggle next to the slider
  return (
    <div className="w-number">
      {w.obj.meta?.topic_write_onoff && <Toggle fn={w.obj} ctx={ctx} />}
      <NumberSet fn={w.obj} ctx={ctx} />
    </div>
  );
}

// ---- gauge ---------------------------------------------------------------------------------
export function GaugeWidget({ w, ctx }) {
  const v = ctx.valueOf(w.obj);
  const min = Number(w.layout.min ?? 0);
  const max = Number(w.layout.max ?? 100);
  const n = Number(v?.value);
  const frac = Number.isFinite(n) && max > min ? Math.min(1, Math.max(0, (n - min) / (max - min))) : 0;
  const r = 40;
  const len = Math.PI * r;
  return (
    <div className="w-gauge">
      <svg viewBox="0 0 100 58" className="gauge">
        <path d="M10 50 A40 40 0 0 1 90 50" className="track" />
        <path d="M10 50 A40 40 0 0 1 90 50" className="fill" style={{ strokeDasharray: `${len * frac} ${len}` }} />
      </svg>
      <div className="big">{formatValue(w.obj, v?.value)}</div>
      <div className="row between small muted gauge-scale">
        <span>{min}</span>
        <span>{formatAge(v?.timestamp)}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

// ---- chart: one function, same engine as the multi-line graph (zoom, ranges, sampling) -----------
export function ChartWidget(props) {
  return <MultiChartWidget {...props} single />;
}

// ---- device card ---------------------------------------------------------------------------
export function CardWidget({ w, ctx }) {
  const fns = (ctx.raw?.functions || []).filter((f) => String(f.meta?.device_id) === String(w.obj.id) && !isHidden(f));
  if (!fns.length) return <div className="muted small">Inga funktioner kopplade till enheten (meta.device_id).</div>;
  return (
    <ul className="w-card">
      {fns.map((f) => {
        const v = ctx.valueOf(f);
        return (
          <li key={f.id} {...staleProps(f, ctx.raw)}>
            <span className="name">{fnName(f)}</span>
            <span className={`val ${stClass(f, v?.value)}`}>
              {writeTopic(f) && isBinary(f) ? (
                <Toggle fn={f} ctx={ctx} compact />
              ) : writeTopic(f) ? (
                <>
                  {f.meta?.topic_write_onoff && <Toggle fn={f} ctx={ctx} compact />}
                  {!rangeOf(f) && formatValue(f, v?.value)} <NumberSet fn={f} ctx={ctx} compact />
                </>
              ) : (
                formatValue(f, v?.value)
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export const WIDGET_COMPONENTS = {
  timeline: TimelineWidget,
  multichart: MultiChartWidget,
  value: ValueWidget,
  status: StatusWidget,
  switch: SwitchWidget,
  number: NumberWidget,
  gauge: GaugeWidget,
  chart: ChartWidget,
  card: CardWidget,
};
