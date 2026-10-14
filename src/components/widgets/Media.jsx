import { useEffect, useState } from 'react';
import { formatAge, formatValue, isOn, onOffValues, stateFor } from '../../lib/format.js';
import { controlTopic, fnName, onOffTopics, rangeOf, writeTopic } from '../../lib/dashboard.js';
import { mediaFunctions, mediaStateText } from '../../lib/media.js';
import { Icon } from '../icons.jsx';

/** On/off state of a switch-like function, with an optimistic value until the device answers. */
function useSwitch(fn, ctx) {
  const { read, write: usual } = fn ? onOffTopics(fn) : {};
  const write = fn ? controlTopic(fn, usual) : '';
  const v = fn ? ctx.valueOfTopic(read) : null;
  const [pending, setPending] = useState(null);
  useEffect(() => setPending(null), [v?.timestamp, v?.value]);
  useEffect(() => {
    if (pending === null) return;
    const t = setTimeout(() => setPending(null), 8000); // back to the reported state if nothing comes back
    return () => clearTimeout(t);
  }, [pending]);
  const on = pending ?? (v ? isOn(fn, v.value) : false);
  const set = (next) => {
    if (!write) return 'Funktionen saknar topic_write';
    const { on: onVal, off: offVal } = onOffValues(fn);
    if (!ctx.publish(write, next ? onVal : offVal)) return 'Ingen MQTT-anslutning';
    setPending(next);
    return '';
  };
  return { v, on, set, write, pending: pending !== null };
}

/** The player's state as text: a state_<x>/text_<x> match, a text value, or the msg. */
function stateTextOf(fn, v) {
  if (!v) return '';
  if (stateFor(fn, v.value)) return formatValue(fn, v.value);
  const val = v.value;
  if (typeof val === 'string' && val.trim() && !Number.isFinite(Number(val))) return mediaStateText(val);
  if (v.msg) return mediaStateText(v.msg);
  return val === undefined || val === null || val === '' ? '' : formatValue(fn, val);
}

const rawState = (fn, v) => {
  if (!v) return '';
  const s = typeof v.value === 'string' && !Number.isFinite(Number(v.value)) ? v.value : v.msg;
  return String(s || '').trim().toLowerCase();
};

/**
 * Media player: current track (msg of "Uppspelning"), state, play/pause, volume, mute and power. Only the
 * controls whose functions the device has are shown.
 */
export function MediaWidget({ w, ctx }) {
  const m = mediaFunctions(ctx.raw, w.obj.id);
  const play = useSwitch(m.playing, ctx);
  const mute = useSwitch(m.mute, ctx);
  const power = useSwitch(m.power, ctx);
  const stateV = m.state ? ctx.valueOf(m.state) : null;
  const volV = m.volume ? ctx.valueOf(m.volume) : null;
  const range = (m.volume && rangeOf(m.volume)) || { min: 0, max: 100, step: 1 };
  const [slide, setSlide] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => setSlide(null), [volV?.timestamp, volV?.value]);

  if (!m.playing && !m.state) return <div className="muted small">Enheten har ingen funktion för uppspelning eller status (topic …/playing eller …/state).</div>;

  const st = rawState(m.state, stateV);
  const off = (m.power && power.v && !power.on && !power.pending) || st === 'off' || st === 'unavailable';
  // the track stays while paused; idle/off clear it at the source (empty msg)
  const track = String(play.v?.msg || '').trim();
  const stateText = stateTextOf(m.state, stateV) || (m.playing && play.v ? (play.on ? 'Spelar' : 'Pausad') : '');
  const lastTs = Math.max(play.v?.timestamp || 0, stateV?.timestamp || 0);
  const vol = slide ?? (Number.isFinite(Number(volV?.value)) ? Number(volV.value) : range.min);
  const volWrite = m.volume ? writeTopic(m.volume) : '';
  const act = (msg) => setErr(msg || '');
  const sendVol = () => {
    if (slide === null) return;
    if (!volWrite) return act('Volym saknar topic_write');
    act(ctx.publish(volWrite, slide) ? '' : 'Ingen MQTT-anslutning');
  };
  const [artist, title] = track.includes(' – ') ? [track.slice(0, track.indexOf(' – ')), track.slice(track.indexOf(' – ') + 3)] : ['', track];

  return (
    <div className={`media ${off ? 'is-off' : ''}`}>
      <div className="media-now">
        <span className="media-art" aria-hidden="true">
          <Icon name="music" size={22} />
        </span>
        <div className="grow media-text">
          {track ? (
            <>
              <div className="media-title" title={track}>
                {title}
              </div>
              {artist && <div className="media-artist muted">{artist}</div>}
            </>
          ) : (
            <div className="media-title muted">{off ? 'Avstängd' : 'Inget spelas'}</div>
          )}
          <div className="muted small">
            {stateText}
            {lastTs ? ` · ${formatAge(lastTs)}` : ''}
          </div>
        </div>
      </div>
      <div className="media-ctl">
        {m.power && (
          <button type="button" className={`media-btn ${power.on ? 'on' : ''}`} aria-pressed={power.on} aria-label={power.on ? 'Stäng av' : 'Slå på'} title={`${fnName(m.power)}: ${power.on ? 'på' : 'av'}`} disabled={!power.write} onClick={() => act(power.set(!power.on))}>
            <Icon name="power" size={18} />
          </button>
        )}
        {m.playing && (
          <button type="button" className="media-btn primary" aria-label={play.on ? 'Pausa' : 'Spela'} title={play.on ? 'Pausa' : 'Spela'} disabled={!play.write} onClick={() => act(play.set(!play.on))}>
            <Icon name={play.on ? 'pause' : 'play'} size={20} />
          </button>
        )}
        {m.mute && (
          <button type="button" className={`media-btn ${mute.on ? 'on' : ''}`} aria-pressed={mute.on} aria-label={mute.on ? 'Slå på ljudet' : 'Stäng av ljudet'} title={mute.on ? 'Ljudet är avstängt' : 'Stäng av ljudet'} disabled={!mute.write} onClick={() => act(mute.set(!mute.on))}>
            <Icon name={mute.on ? 'mute' : 'volume'} size={18} />
          </button>
        )}
        {m.volume && (
          <label className="media-vol grow">
            <input
              type="range"
              min={range.min}
              max={range.max}
              step={range.step}
              value={vol}
              disabled={!volWrite}
              aria-label={`Volym för ${w.name}`}
              onChange={(e) => setSlide(Number(e.target.value))}
              onPointerUp={sendVol}
              onKeyUp={sendVol}
            />
            <span className="small media-vol-val">{volV || slide !== null ? (m.volume.meta?.unit || m.volume.meta?.format ? formatValue(m.volume, vol) : `${Math.round(vol)} %`) : '–'}</span>
          </label>
        )}
      </div>
      {err && <div className="err small">{err}</div>}
    </div>
  );
}
