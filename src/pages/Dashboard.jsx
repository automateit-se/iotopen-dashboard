import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useInstallation } from '../context/useInstallation.js';
import { WIDGET_COMPONENTS } from '../components/widgets/Widgets.jsx';
import { WidgetEditor } from '../components/WidgetEditor.jsx';
import { AddWidget } from '../components/AddWidget.jsx';
import { InstallationSettings } from '../components/InstallationSettings.jsx';
import { TimelineEditor } from '../components/TimelineEditor.jsx';
import { LinkEditor } from '../components/LinkEditor.jsx';
import { MqttEditor } from '../components/MqttEditor.jsx';
import { TextEditor } from '../components/TextEditor.jsx';
import { mqttShown } from '../components/widgets/Mqtt.jsx';
import { newMqttKey } from '../lib/mqttWidget.js';
import { PageEditor, PageTabs } from '../components/Pages.jsx';
import { useBackground } from '../context/useBackground.js';
import { backgroundOf } from '../lib/background.js';
import { config } from '../api/config.js';
import { localPages, startPage, excludedTypes } from '../lib/local.js';
import { useLocalStatus } from '../components/LocalBar.jsx';
import { worstStatus, staleOf, staleDevice } from '../lib/status.js';
import { errText } from '../components/Modal.jsx';
import { Icon } from '../components/icons.jsx';
import { INST_META, OBJ_META, GROUPS, WIDGET_LABEL, THEME_META, EXTRA_FIELDS, applyTheme, isAdmin, writeLayout, writeObjectMeta, suggestType, widgetFunctions, fnName, stateColor, isLight, newLinkKey, newExtraKey, newTextKey, widgetTypes, widgetKey, keyOf, pagesOf, pageOfWidget, newPageId, writeBackground } from '../lib/dashboard.js';

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

export default function Dashboard({ iid, pageId = '' }) {
  const { user, setBrandLogo } = useApp();
  const ctx = useInstallation(iid);
  const { inst, raw, layout, setLayout, widgets, logo, reloadLogo, error, loading, liveState, reload } = ctx;
  const cols = useColumns();
  const [editing, setEditing] = useState(false);
  const [editor, setEditor] = useState(null); // { kind, obj, isNew }
  const [adding, setAdding] = useState(false);
  const [timelineEditor, setTimelineEditor] = useState(null); // { group: 'timeline'|'chart', name } – name null = new
  const [linkEditor, setLinkEditor] = useState(null); // { key } – key null = new
  const [mqttEditor, setMqttEditor] = useState(null); // { key } – key null = new
  const [textEditor, setTextEditor] = useState(null); // { key } - key null = new
  const [pageEditor, setPageEditor] = useState(null); // { id } – id null = new
  const [settings, setSettings] = useState(false);
  const [dragKey, setDragKey] = useState(null);
  const [saveError, setSaveError] = useState('');

  // local mode (edge app): view only, the pages and widget types chosen on the app instance
  const local = config.local;
  // locally, "Live" only says the browser reaches the edge app; without IoT Open it is "Lokalt" in yellow
  const localStatus = useLocalStatus();
  const cutOff = !!local && liveState === 'live' && localStatus?.cloud === false;
  const admin = !local && inst && user ? isAdmin(user, inst) : false;
  // pages: the one in the address, else the first (locally the start page); each widget is on one page
  const allPages = pagesOf(layout);
  const pages = local ? localPages(allPages, local.pages) : allPages;
  const page = pages.find((p) => p.id === pageId) || (local ? startPage(pages, local.start) : pages[0]);
  const hiddenTypes = local ? excludedTypes(local.exclude) : null;
  const onPage = widgets.filter((w) => pageOfWidget(w, allPages) === page.id && !hiddenTypes?.has(w.type));
  // visible = "false" in IoT Open hides a widget; in edit mode it stays (dimmed) so it can be managed
  const shown = editing ? onPage : onPage.filter((w) => !w.hidden);
  // a new widget lands on the page being edited (nothing stored for the first page)
  const pageField = page.id === pages[0].id ? {} : { page: page.id };
  const title = inst?.meta?.[INST_META.title] || inst?.name || `Installation ${iid}`;
  // background image of the page (file dashboard-bg-<page>.jpg); with one, the widgets turn to glass
  const bg = backgroundOf(page);
  const bgUrl = useBackground(iid, page.id, !!bg, layout);
  const glass = !!(bg && bgUrl);

  useEffect(() => {
    document.title = title;
  }, [title]);

  // colours from installation meta dashboard.color_*, with the page's own colours on top (restored when leaving)
  const themeMeta = { ...(inst?.meta || {}), ...(page.theme || {}) };
  const themeKey = JSON.stringify(THEME_META.map((t) => themeMeta[t.key] || ''));
  useEffect(() => (inst ? applyTheme({ ...inst, meta: themeMeta }) : undefined), [themeKey, !!inst]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!oldType) Object.assign(entry, pageField);
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
   * Extra widgets (layout file only): a new one when the object already has a widget of the type, or an existing
   * "x:<n>". Name, icon, colour and control settings go to the layout entry, the rest (limits, states, visible)
   * to the object's metadata as usual.
   */
  const onSaveExtra = async (key, kind, base, metaValues, params) => {
    const { widget: type, ...rest } = metaValues;
    const own = {};
    const shared = {};
    for (const [k, v] of Object.entries(rest)) (EXTRA_FIELDS[k] ? (own[EXTRA_FIELDS[k]] = v) : (shared[k] = v));
    // the object's own name/icon are not copied into the widget, so they keep following the object
    if (own.label === String(base.meta?.[OBJ_META.nickname] || '')) own.label = '';
    if (own.icon === String(base.meta?.[OBJ_META.icon] || '')) own.icon = '';
    await writeObjectMeta(iid, kind, base, shared);
    const all = { ...layout.widgets };
    widgets.forEach((w, i) => (all[w.key] = { ...(all[w.key] || {}), order: i }));
    const k = key || newExtraKey(layout);
    const entry = { ...(all[k] || { order: widgets.length, ...pageField }), ...params, ...own, type, ref: keyOf(kind, base.id) };
    for (const [p, v] of Object.entries(entry)) if (v === '' || v === undefined) delete entry[p];
    if (key) for (const f of Object.values(EXTRA_FIELDS)) if (!own[f]) delete entry[f];
    await writeLayout(iid, { ...layout, widgets: { ...all, [k]: entry } });
    setEditor(null);
    await reload({ quiet: true });
  };

  /** Removes a layout-only widget (extra widget, link button). */
  const onRemoveEntry = async (key) => {
    const all = { ...layout.widgets };
    delete all[key];
    await writeLayout(iid, { ...layout, widgets: all });
    setEditor(null);
    setLinkEditor(null);
    setMqttEditor(null);
    setTextEditor(null);
    await reload({ quiet: true });
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
    all[key] = { ...(oldEntry || { order: widgets.length, ...pageField }), ...rest, ...(color ? { color } : {}) };
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
    all[k] = { ...(all[k] || { order: widgets.length, ...pageField }), ...params };
    for (const p of ['color', 'icon', 'url', 'target_page', 'label']) if (!all[k][p]) delete all[k][p];
    await writeLayout(iid, { ...layout, widgets: all });
    setLinkEditor(null);
    await reload({ quiet: true });
  };

  const onRemoveLink = onRemoveEntry;

  /** MQTT widgets exist only in the layout file; empty settings are left out of the entry. */
  const onSaveMqtt = async (key, params) => {
    const all = { ...layout.widgets };
    widgets.forEach((w, i) => (all[w.key] = { ...(all[w.key] || {}), order: i }));
    const k = key || newMqttKey(layout);
    all[k] = { ...(all[k] || { order: widgets.length, ...pageField }), ...params };
    for (const [p, v] of Object.entries(all[k])) if (v === '' || v === undefined || v === null) delete all[k][p];
    await writeLayout(iid, { ...layout, widgets: all });
    setMqttEditor(null);
    await reload({ quiet: true });
  };

  /** Text widgets exist only in the layout file; empty settings and unset styles are left out of the entry. */
  const onSaveText = async (key, params) => {
    const all = { ...layout.widgets };
    widgets.forEach((w, i) => (all[w.key] = { ...(all[w.key] || {}), order: i }));
    const k = key || newTextKey(layout);
    all[k] = { ...(all[k] || { order: widgets.length, ...pageField }), ...params };
    for (const [p, v] of Object.entries(all[k])) if (v === '' || v === false || v === undefined || v === null) delete all[k][p];
    await writeLayout(iid, { ...layout, widgets: all });
    setTextEditor(null);
    await reload({ quiet: true });
  };

  /** Moves a widget to another page (the first page = no "page" in its entry). */
  const moveToPage = (w, id) => {
    const next = { ...layout, widgets: { ...layout.widgets } };
    const entry = { ...(next.widgets[w.key] || {}) };
    if (id === pages[0].id) delete entry.page;
    else entry.page = id;
    next.widgets[w.key] = entry;
    saveLayout(next);
  };

  /**
   * Pages: title, icon, own colours and background; a removed page's widgets go to the first page. `image` is a
   * new background image (Blob), null to remove it, undefined to keep it; it is written before the layout.
   */
  const onSavePage = async (id, values, image) => {
    const list = layout.pages?.length ? [...layout.pages] : [{ ...pages[0] }];
    const target = id || newPageId(values.title, list);
    if (image !== undefined) await writeBackground(iid, target, image);
    if (id) list.splice(list.findIndex((p) => p.id === id), 1, { ...list.find((p) => p.id === id), ...values });
    else list.push({ id: target, ...values });
    for (const p of list) {
      if (p.theme && !Object.keys(p.theme).length) delete p.theme;
      if (!p.background) delete p.background;
    }
    await saveLayout({ ...layout, pages: list });
    setPageEditor(null);
    navigate(target);
  };

  const onRemovePage = async (id) => {
    if (backgroundOf(pages.find((p) => p.id === id))) await writeBackground(iid, id, null);
    const list = (layout.pages || []).filter((p) => p.id !== id);
    const all = { ...layout.widgets };
    for (const [k, e] of Object.entries(all)) {
      if (e?.page === id || (e?.page && e.page === list[0]?.id)) {
        const { page: _p, ...restEntry } = e;
        all[k] = restEntry;
      }
      if (e?.target_page === id) all[k] = { ...all[k], target_page: list[0]?.id || '' };
    }
    await saveLayout({ ...layout, pages: list.length ? list : undefined, widgets: all });
    setPageEditor(null);
    navigate(list[0]?.id || '');
  };

  /** Moves a page one step left (-1) or right (+1) in the tabs. */
  const movePage = (id, step) => {
    const list = [...pages];
    const i = list.findIndex((p) => p.id === id);
    const j = i + step;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    // the first page holds the widgets without "page": every widget keeps its page when the first one changes
    const all = { ...layout.widgets };
    for (const w of widgets) {
      const cur = pageOfWidget(w, pages);
      all[w.key] = { ...(all[w.key] || {}) };
      if (cur === list[0].id) delete all[w.key].page;
      else all[w.key].page = cur;
    }
    saveLayout({ ...layout, pages: list, widgets: all });
  };

  const navigate = (id) => {
    window.location.hash = !id || id === (layout.pages?.[0]?.id || pages[0].id) ? `#/i/${iid}` : `#/i/${iid}/p/${encodeURIComponent(id)}`;
  };

  const openEditor = (w) => {
    if (w.kind === 'missing') {
      if (window.confirm(`Ta bort "${w.name}"? Funktionen eller enheten den visade finns inte längre.`)) onRemoveEntry(w.key);
      return;
    }
    if (GROUPS[w.kind]) return setTimelineEditor({ group: w.kind, name: w.name });
    if (w.kind === 'link') return setLinkEditor({ key: w.key });
    if (w.kind === 'mqtt') return setMqttEditor({ key: w.key });
    if (w.kind === 'text') return setTextEditor({ key: w.key });
    setEditor({ kind: w.kind, obj: w.obj, base: w.baseObj || w.obj, extra: !!w.extra, widgetType: w.type, key: w.key });
  };

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
    <div className={`page ${glass ? 'has-bg' : ''}`}>
      {glass && (
        <div className={`page-bg ${bg.blur ? 'blur' : ''}`} style={{ '--bg-dim': bg.dim / 100 }} aria-hidden="true">
          <div style={{ backgroundImage: `url("${bgUrl}")` }} />
        </div>
      )}
      <div className="page-head">
        <div>
          {!local && (
            <a href="#/" className="back">
              <Icon name="back" size={16} /> Installationer
            </a>
          )}
          <h1>{title}</h1>
        </div>
        <div className="row gap wrap">
          <span
            className={`live ${cutOff ? 'local-only' : liveState === 'live' ? 'on' : ''}`}
            title={
              cutOff
                ? 'Lokalt: edge clienten når inte IoT Open. Värden och styrning från enheterna på installationen fungerar, historiken är den som appen har sparat.'
                : 'Live = värden kommer via MQTT. Polling = REST var 30:e sekund.'
            }
          >
            <span className="dot" /> {cutOff ? 'Lokalt' : LIVE_LABEL[liveState] || liveState}
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

      {(pages.length > 1 || editing) && (
        <PageTabs
          iid={iid}
          pages={pages}
          explicit={!!local}
          current={page.id}
          editing={editing}
          onAdd={() => setPageEditor({ id: null })}
          onEdit={() => setPageEditor({ id: page.id })}
          onMove={(step) => movePage(page.id, step)}
        />
      )}
      {editing && <div className="info-box">Redigeringsläge. Dra i en widget för att flytta den, klicka på kugghjulet för att ändra den. Allt sparas direkt i IoT Open.</div>}
      {saveError && <div className="error-box">{saveError}</div>}
      {error && inst && <div className="error-box">Kunde inte läsa om installationen: {errText(error)}</div>}

      {loading && !raw ? (
        <p className="muted">Läser installationen…</p>
      ) : !shown.length ? (
        <div className="empty">
          <h2>{widgets.length ? 'Inga widgets på den här sidan' : 'Inga widgets ännu'}</h2>
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
        <div className={`grid ${glass ? `glass ${bg.glass ? 'frost' : ''}` : ''}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, ...(glass ? { '--glass-alpha': bg.opacity / 100 } : {}) }}>
          {shown.map((w) => {
            const C = WIDGET_COMPONENTS[w.type];
            // silent (metric_monitor.status > 0): greyed out; its stale value does not drive Warning/Critical
            const stale = w.kind === 'function' ? staleOf(w.obj, raw) : w.kind === 'device' ? staleDevice(w.obj) : null;
            const st = stale ? null : worstStatus(widgetFunctions(w, raw).filter((f) => !staleOf(f, raw)).map((f) => [f, ctx.valueOf(f)?.value]));
            // value widget: dashboard.color_<state> fills the tile (e.g. a banner "Larmat" in red); a Warning/Critical status wins
            const fill = w.type === 'value' && !stale && !(st && st.level > 0) ? stateColor(w.obj, ctx.valueOf(w.obj)?.value) : w.type === 'mqtt' && (w.layout.mode || 'value') === 'value' ? mqttShown(w, ctx)?.color || '' : '';
            const h = Number(w.layout.h) || 1;
            // the button itself carries the name for link and push buttons; a text without a heading is just the text
            const bare = w.type === 'www' || w.type === 'button' || (w.type === 'text' && !String(w.layout.label || '').trim());
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
                      {pages.length > 1 && (
                        <select className="page-move" value={page.id} onChange={(e) => moveToPage(w, e.target.value)} aria-label={`Sida för ${w.name}`} title="Flytta till en annan sida">
                          {pages.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.title}
                            </option>
                          ))}
                        </select>
                      )}
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
          onNewMqtt={() => {
            setAdding(false);
            setMqttEditor({ key: null });
          }}
          onNewText={() => {
            setAdding(false);
            setTextEditor({ key: null });
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
          raw={raw}
          isNew={editor.isNew}
          extra={editor.extra}
          widgetType={editor.widgetType}
          layoutEntry={editor.isNew ? { suggested: editor.type || suggestType(editor.kind, editor.obj) } : layout.widgets[editor.key] || {}}
          onClose={() => setEditor(null)}
          onSave={(meta, params) =>
            editor.extra
              ? onSaveExtra(editor.key, editor.kind, editor.base, meta, params)
              : editor.isNew && widgetTypes(editor.obj).includes(meta.widget)
                ? onSaveExtra(null, editor.kind, editor.obj, meta, params)
                : onSaveWidget(editor.kind, editor.obj, editor.isNew ? null : editor.widgetType, meta, params)
          }
          onRemove={() => (editor.extra ? onRemoveEntry(editor.key) : onRemoveWidget(editor.kind, editor.obj, editor.widgetType))}
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
          pages={pages}
          onClose={() => setLinkEditor(null)}
          onSave={(params) => onSaveLink(linkEditor.key, params)}
          onRemove={() => onRemoveLink(linkEditor.key)}
        />
      )}
      {mqttEditor && (
        <MqttEditor
          entry={mqttEditor.key ? layout.widgets[mqttEditor.key] : null}
          raw={raw}
          mqtt={ctx.mqtt}
          onClose={() => setMqttEditor(null)}
          onSave={(params) => onSaveMqtt(mqttEditor.key, params)}
          onRemove={() => onRemoveEntry(mqttEditor.key)}
        />
      )}
      {textEditor && (
        <TextEditor
          entry={textEditor.key ? layout.widgets[textEditor.key] : null}
          onClose={() => setTextEditor(null)}
          onSave={(params) => onSaveText(textEditor.key, params)}
          onRemove={() => onRemoveEntry(textEditor.key)}
        />
      )}
      {pageEditor && (
        <PageEditor
          page={pageEditor.id ? pages.find((p) => p.id === pageEditor.id) : null}
          bgUrl={pageEditor.id === page.id ? bgUrl : null}
          canRemove={pages.length > 1}
          onClose={() => setPageEditor(null)}
          onSave={(values, image) => onSavePage(pageEditor.id, values, image)}
          onRemove={() => onRemovePage(pageEditor.id)}
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
