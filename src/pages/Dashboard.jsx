import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useInstallation } from '../context/useInstallation.js';
import { WIDGET_COMPONENTS } from '../components/widgets/Widgets.jsx';
import { WidgetEditor } from '../components/WidgetEditor.jsx';
import { AddWidget } from '../components/AddWidget.jsx';
import { InstallationSettings } from '../components/InstallationSettings.jsx';
import { TimelineEditor } from '../components/TimelineEditor.jsx';
import { LinkEditor } from '../components/LinkEditor.jsx';
import { worstStatus, staleOf, staleDevice } from '../lib/status.js';
import { errText } from '../components/Modal.jsx';
import { Icon } from '../components/icons.jsx';
import { INST_META, OBJ_META, GROUPS, WIDGET_LABEL, THEME_META, applyTheme, isAdmin, writeLayout, writeObjectMeta, suggestType, widgetFunctions, fnName, stateColor, isLight, newLinkKey, widgetTypes, widgetKey } from '../lib/dashboard.js';

const LIVE_LABEL = { live: 'Live', connecting: 'Ansluter…', offline: 'Polling', failed: 'Polling', off: 'Polling' };

function useColumns() {
  // 8-column grid (layout version 2): 2 columns on a phone, so w = 1 puts two small widgets side by side
  const calc = () => (window.innerWidth < 640 ? 2 : window.innerWidth < 1000 ? 4 : window.innerWidth < 1400 ? 6 : 8);
  const [cols, setCols] = useState(calc);
  useEffect(() => {
    const on = () => setCols(calc());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return cols;
}

export default function Dashboard({ iid }) {
  const { user, setBrandLogo } = useApp();
  const ctx = useInstallation(iid);
  const { inst, raw, layout, setLayout, widgets, logo, reloadLogo, error, loading, liveState, reload } = ctx;
  const cols = useColumns();
  const [editing, setEditing] = useState(false);
  const [editor, setEditor] = useState(null); // { kind, obj, isNew }
  const [adding, setAdding] = useState(false);
  const [timelineEditor, setTimelineEditor] = useState(null); // { group: 'timeline'|'chart', name } – name null = new
  const [linkEditor, setLinkEditor] = useState(null); // { key } – key null = new
  const [settings, setSettings] = useState(false);
  const [dragKey, setDragKey] = useState(null);
  const [saveError, setSaveError] = useState('');

  const admin = inst && user ? isAdmin(user, inst) : false;
  // visible = "false" in IoT Open hides a widget; in edit mode it stays (dimmed) so it can be managed
  const shown = editing ? widgets : widgets.filter((w) => !w.hidden);
  const title = inst?.meta?.[INST_META.title] || inst?.name || `Installation ${iid}`;

  useEffect(() => {
    document.title = title;
  }, [title]);

  // colours from installation meta dashboard.color_* (restored when leaving the installation)
  const themeKey = JSON.stringify(THEME_META.map((t) => inst?.meta?.[t.key] || ''));
  useEffect(() => (inst ? applyTheme(inst) : undefined), [themeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // logo from the installation file dashboard-logo.png in the header (IoT Open's again when leaving)
  useEffect(() => {
    setBrandLogo(logo);
    return () => setBrandLogo(null);
  }, [logo, setBrandLogo]);

  /** Writes the layout file and keeps the new layout locally. */
  const saveLayout = async (next) => {
    setLayout(next);
    setSaveError('');
    try {
      await writeLayout(iid, next);
    } catch (e) {
      setSaveError(`Layouten sparades inte: ${errText(e)}`);
    }
  };

  /**
   * Layout entries of an object after its list of widget types changed. Each entry follows its type (keys are
   * "f:<id>" for the first type and "f:<id>:<type>" for the others); `renamed` carries one entry over to a new type.
   */
  const relayout = (all, kind, obj, before, after, renamed = {}) => {
    const byType = Object.fromEntries(before.map((t, i) => [t, all[widgetKey(kind, obj.id, t, i)]]));
    for (const [from, to] of Object.entries(renamed)) byType[to] = byType[from];
    before.forEach((t, i) => delete all[widgetKey(kind, obj.id, t, i)]);
    after.forEach((t, i) => byType[t] && (all[widgetKey(kind, obj.id, t, i)] = byType[t]));
    return all;
  };

  /** Saves one widget: `oldType` = the type it had (null for a new widget, which is added to the object's list). */
  const onSaveWidget = async (kind, obj, oldType, metaValues, params) => {
    const before = widgetTypes(obj);
    const type = metaValues.widget;
    const after = oldType ? before.map((t) => (t === oldType ? type : t)) : [...before, type];
    await writeObjectMeta(iid, kind, obj, { ...metaValues, widget: after.join(',') });
    // freeze the current visual order so a new widget lands last instead of jumping first
    const all = { ...layout.widgets };
    widgets.forEach((w, i) => (all[w.key] = { ...(all[w.key] || {}), order: i }));
    relayout(all, kind, obj, before, after, oldType && oldType !== type ? { [oldType]: type } : {});
    const key = widgetKey(kind, obj.id, type, after.indexOf(type));
    const entry = { ...(all[key] || {}), ...params };
    if (!entry.color) delete entry.color;
    if (entry.order === undefined) entry.order = widgets.length;
    await writeLayout(iid, { ...layout, widgets: { ...all, [key]: entry } });
    setEditor(null);
    await reload({ quiet: true });
  };

  const onRemoveWidget = async (kind, obj, type) => {
    // remove = take the type out of dashboard.widget; nickname/colour/icon stay so the widget can be brought back
    const before = widgetTypes(obj);
    const after = before.filter((t) => t !== type);
    await writeObjectMeta(iid, kind, obj, { widget: after.join(',') });
    // the last one: the layout entry stays, so the widget comes back with its size
    if (after.length) await writeLayout(iid, { ...layout, widgets: relayout({ ...layout.widgets }, kind, obj, before, after) });
    setEditor(null);
    await reload({ withLayout: !!after.length, quiet: true });
  };

  /**
   * Group widgets (timeline / multi-line graph): membership = dashboard.timeline / dashboard.chart meta on
   * each function; size/hours/colour under "<prefix>:<name>" in the layout.
   */
  const onSaveGroup = async (group, oldName, name, ids, params) => {
    const g = GROUPS[group];
    const want = new Set(ids);
    for (const f of raw.functions) {
      const cur = String(f.meta?.[g.metaKey] || '');
      const next = want.has(f.id) ? name : cur === oldName ? '' : cur;
      if (next !== cur) await writeObjectMeta(iid, 'function', f, { [g.metaKey]: next });
    }
    const all = { ...layout.widgets };
    widgets.forEach((w, i) => (all[w.key] = { ...(all[w.key] || {}), order: i }));
    const oldEntry = oldName ? all[`${g.prefix}:${oldName}`] : null;
    if (oldName) delete all[`${g.prefix}:${oldName}`];
    const { color, ...rest } = params;
    const key = `${g.prefix}:${name}`;
    all[key] = { ...(oldEntry || { order: widgets.length }), ...rest, ...(color ? { color } : {}) };
    if (!color) delete all[key].color;
    if (!Object.keys(all[key].series || {}).length) delete all[key].series;
    await writeLayout(iid, { ...layout, widgets: all });
    setTimelineEditor(null);
    await reload({ quiet: true });
  };

  const onRemoveGroup = async (group, name) => {
    const g = GROUPS[group];
    for (const f of raw.functions) if (f.meta?.[g.metaKey] === name) await writeObjectMeta(iid, 'function', f, { [g.metaKey]: '' });
    const all = { ...layout.widgets };
    delete all[`${g.prefix}:${name}`];
    await writeLayout(iid, { ...layout, widgets: all });
    setTimelineEditor(null);
    await reload({ quiet: true });
  };

  /** Link buttons (www) exist only in the layout file. */
  const onSaveLink = async (key, params) => {
    const all = { ...layout.widgets };
    widgets.forEach((w, i) => (all[w.key] = { ...(all[w.key] || {}), order: i }));
    const k = key || newLinkKey(layout);
    all[k] = { ...(all[k] || { order: widgets.length }), ...params };
    for (const p of ['color', 'icon']) if (!all[k][p]) delete all[k][p];
    await writeLayout(iid, { ...layout, widgets: all });
    setLinkEditor(null);
    await reload({ quiet: true });
  };

  const onRemoveLink = async (key) => {
    const all = { ...layout.widgets };
    delete all[key];
    await writeLayout(iid, { ...layout, widgets: all });
    setLinkEditor(null);
    await reload({ quiet: true });
  };

  const openEditor = (w) =>
    GROUPS[w.kind] ? setTimelineEditor({ group: w.kind, name: w.name }) : w.kind === 'link' ? setLinkEditor({ key: w.key }) : setEditor({ kind: w.kind, obj: w.obj, widgetType: w.type, key: w.key });

  const onDrop = (targetKey) => {
    if (!dragKey || dragKey === targetKey) return setDragKey(null);
    const keys = widgets.map((w) => w.key);
    const from = keys.indexOf(dragKey);
    keys.splice(from, 1);
    keys.splice(keys.indexOf(targetKey) + (from <= keys.indexOf(targetKey) ? 1 : 0), 0, dragKey);
    const next = { ...layout, widgets: { ...layout.widgets } };
    keys.forEach((k, i) => (next.widgets[k] = { ...(next.widgets[k] || {}), order: i }));
    setDragKey(null);
    saveLayout(next);
  };

  if (error && !inst) {
    return (
      <div className="page">
        <a href="#/" className="back">
          <Icon name="back" size={16} /> Installationer
        </a>
        <div className="error-box">{error.status === 403 ? 'Du saknar behörighet till installationen.' : errText(error)}</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <a href="#/" className="back">
            <Icon name="back" size={16} /> Installationer
          </a>
          <h1>{title}</h1>
        </div>
        <div className="row gap wrap">
          <span className={`live ${liveState === 'live' ? 'on' : ''}`} title="Live = värden kommer via MQTT. Polling = REST var 30:e sekund.">
            <span className="dot" /> {LIVE_LABEL[liveState] || liveState}
          </span>
          {admin && !editing && (
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              <Icon name="edit" size={16} /> Redigera
            </button>
          )}
          {editing && (
            <>
              <button type="button" className="btn" onClick={() => setSettings(true)}>
                <Icon name="settings" size={16} /> Inställningar
              </button>
              <button type="button" className="btn" onClick={() => setAdding(true)} disabled={!raw}>
                <Icon name="plus" size={16} /> Lägg till widget
              </button>
              <button type="button" className="btn primary" onClick={() => setEditing(false)}>
                Klar
              </button>
            </>
          )}
        </div>
      </div>

      {editing && <div className="info-box">Redigeringsläge. Dra i en widget för att flytta den, klicka på kugghjulet för att ändra den. Allt sparas direkt i IoT Open.</div>}
      {saveError && <div className="error-box">{saveError}</div>}
      {error && inst && <div className="error-box">Kunde inte läsa om installationen: {errText(error)}</div>}

      {loading && !raw ? (
        <p className="muted">Läser installationen…</p>
      ) : !shown.length ? (
        <div className="empty">
          <h2>Inga widgets ännu</h2>
          <p className="muted">
            En enhet eller funktion visas när den har metadata <code>{OBJ_META.widget}</code>, till exempel <code>value</code>, <code>chart</code>, <code>gauge</code>, <code>switch</code>, <code>status</code> eller <code>card</code>.
          </p>
          {admin && (
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setEditing(true);
                setAdding(true);
              }}
            >
              <Icon name="plus" size={16} /> Lägg till widget
            </button>
          )}
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {shown.map((w) => {
            const C = WIDGET_COMPONENTS[w.type];
            // silent (metric_monitor.status > 0): greyed out; its stale value does not drive Warning/Critical
            const stale = w.kind === 'function' ? staleOf(w.obj, raw) : w.kind === 'device' ? staleDevice(w.obj) : null;
            const st = stale ? null : worstStatus(widgetFunctions(w, raw).filter((f) => !staleOf(f, raw)).map((f) => [f, ctx.valueOf(f)?.value]));
            // value widget: dashboard.color_<state> fills the tile (e.g. a banner "Larmat" in red); a Warning/Critical status wins
            const fill = w.type === 'value' && !stale && !(st && st.level > 0) ? stateColor(w.obj, ctx.valueOf(w.obj)?.value) : '';
            const h = Number(w.layout.h) || 1;
            // the button itself carries the name for link and push buttons
            const bare = w.type === 'www' || w.type === 'button';
            return (
              <section
                key={w.key}
                className={`tile ${editing ? 'editing' : ''} ${dragKey === w.key ? 'dragging' : ''} ${w.hidden ? 'is-hidden' : ''} ${st && st.level > 0 ? `status-${st.level}` : ''} ${stale ? 'stale' : ''} ${h < 1 ? 'half' : ''} ${fill ? 'filled' : ''} ${bare ? 'bare' : ''}`}
                // the grid has half rows: h = 0.5 is one of them, h = 1 two (plus the gap between)
                style={{ gridColumn: `span ${Math.min(w.layout.w || 1, cols)}`, gridRow: `span ${Math.max(1, Math.round(h * 2))}`, '--tile-color': w.color || undefined, ...(fill ? { '--fill': fill, '--fill-text': isLight(fill) ? '#0d2e3d' : '#ffffff' } : {}) }}
                draggable={editing}
                onDragStart={(e) => {
                  setDragKey(w.key);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => editing && dragKey && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  onDrop(w.key);
                }}
                onDragEnd={() => setDragKey(null)}
              >
                <header>
                  {w.icon && !bare && <Icon name={w.icon} size={18} className="tile-icon" />}
                  {bare ? <span className="grow" /> : <h3 title={w.name}>{w.name}</h3>}
                  {stale && (
                    <span className="stale-badge" title={`metric_monitor: ${stale.text}`}>
                      Tyst
                    </span>
                  )}
                  {st && (
                    <span className={`status-badge s${st.level}`} title={`Status: ${st.text}${st.limits ? ` (gränser ${st.limits})` : ''}${widgetFunctions(w, raw).length > 1 && st.fn ? ` – ${fnName(st.fn)}` : ''}`}>
                      {st.text}
                    </span>
                  )}
                  {w.hidden && <span className="badge" title='visible = "false" i IoT Open – syns bara i redigeringsläget'>Dold</span>}
                  {!w.hidden && editing && w.hiddenFunctions?.length > 0 && <span className="badge">{w.hiddenFunctions.length} dolda</span>}
                  {editing && (
                    <>
                      <span className="grip" title="Dra för att flytta">
                        <Icon name="grip" size={16} />
                      </span>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => openEditor(w)}
                        aria-label={`Redigera ${w.name}`}
                      >
                        <Icon name="settings" size={16} />
                      </button>
                    </>
                  )}
                </header>
                <div className="tile-body">{C ? <C w={w} ctx={ctx} iid={iid} /> : <div className="muted small">Okänd widgettyp "{w.type}". Giltiga: {Object.keys(WIDGET_LABEL).join(', ')}.</div>}</div>
              </section>
            );
          })}
        </div>
      )}

      {adding && raw && (
        <AddWidget
          raw={raw}
          valueOf={ctx.valueOf}
          onClose={() => setAdding(false)}
          onNewGroup={(group) => {
            setAdding(false);
            setTimelineEditor({ group, name: null });
          }}
          onNewLink={() => {
            setAdding(false);
            setLinkEditor({ key: null });
          }}
          onPick={(c, type) => {
            setAdding(false);
            setEditor({ kind: c.kind, obj: c.obj, isNew: true, type });
          }}
        />
      )}
      {editor && (
        <WidgetEditor
          kind={editor.kind}
          obj={editor.obj}
          isNew={editor.isNew}
          widgetType={editor.widgetType}
          layoutEntry={editor.isNew ? { suggested: editor.type || suggestType(editor.kind, editor.obj) } : layout.widgets[editor.key] || {}}
          onClose={() => setEditor(null)}
          onSave={(meta, params) => onSaveWidget(editor.kind, editor.obj, editor.isNew ? null : editor.widgetType, meta, params)}
          onRemove={() => onRemoveWidget(editor.kind, editor.obj, editor.widgetType)}
        />
      )}
      {timelineEditor && raw && (
        <TimelineEditor
          group={timelineEditor.group}
          raw={raw}
          name={timelineEditor.name}
          layoutEntry={timelineEditor.name ? layout.widgets[`${GROUPS[timelineEditor.group].prefix}:${timelineEditor.name}`] : null}
          existingNames={widgets.filter((w) => w.kind === timelineEditor.group).map((w) => w.name)}
          onClose={() => setTimelineEditor(null)}
          onSave={(name, ids, params) => onSaveGroup(timelineEditor.group, timelineEditor.name, name, ids, params)}
          onRemove={() => onRemoveGroup(timelineEditor.group, timelineEditor.name)}
        />
      )}
      {linkEditor && (
        <LinkEditor
          entry={linkEditor.key ? layout.widgets[linkEditor.key] : null}
          onClose={() => setLinkEditor(null)}
          onSave={(params) => onSaveLink(linkEditor.key, params)}
          onRemove={() => onRemoveLink(linkEditor.key)}
        />
      )}
      {settings && inst && (
        <InstallationSettings
          inst={inst}
          user={user}
          logo={logo}
          onClose={() => setSettings(false)}
          onSaved={async () => {
            setSettings(false);
            await Promise.all([reload({ withLayout: false, quiet: true }), reloadLogo()]);
          }}
        />
      )}
    </div>
  );
}
