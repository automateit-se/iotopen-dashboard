// The layout file of one installation as shared state: read, compared and written in one place.
//
// - A failed read never turns into an empty layout: the layout already shown is kept, and nothing is written
//   until the file has been read once (a missing file is a valid, empty layout).
// - Writes are queued: one at a time, and edits made while one is under way are written together afterwards
//   (the newest state wins). Each edit is a function of the newest layout, so quick edits do not undo each other.
// - A re-read while writing waits until the queue is empty, so the echo of an older write cannot bring an older
//   layout back on screen.
// - Each write expects the file to be the one last read or written. When someone else changed it in between, the
//   write stops, their layout is read and shown, and the edit is reported as not saved.

/** Thrown by a write when the file changed since it was last read (another client saved in between). */
export class LayoutConflict extends Error {
  constructor() {
    super('Layouten har ändrats av någon annan');
    this.name = 'LayoutConflict';
  }
}

const STAMP_KEYS = ['updated', 'version'];
/** The layout's content without what every save stamps on it, for comparing two layouts. */
export const layoutContent = (layout) => JSON.stringify(Object.fromEntries(Object.entries(layout || {}).filter(([k]) => !STAMP_KEYS.includes(k)).sort(([a], [b]) => (a < b ? -1 : 1))));
export const sameLayout = (a, b) => layoutContent(a) === layoutContent(b);

export const READ_ERROR = 'Layouten kunde inte läsas från IoT Open. Inget sparas förrän den har lästs.';
export const CONFLICT_ERROR = 'Någon annan ändrade layouten samtidigt. Deras version visas nu och din senaste ändring sparades inte - gör om den.';

/**
 * createLayoutStore({ read, write, onLayout, onStatus, initial })
 *   read()                     -> Promise<{ layout, hash }>  (hash null = no file); throws on a failed read
 *   write(layout, expectHash)  -> Promise<hash>              throws LayoutConflict when the file's hash differs
 *   onLayout(layout)           the layout to show
 *   onStatus({ loaded, readError, saving, saveError })
 * returns { refresh(), update(fn) -> Promise, get(), status() }
 */
export function createLayoutStore({ read, write, onLayout, onStatus, initial = { version: 2, widgets: {} } }) {
  let layout = initial;
  let hash = null;
  let loaded = false;
  let readError = null;
  let saveError = null;
  let writing = false;
  let pending = null; // { layout, waiters: [{ resolve, reject }] }
  let refreshWanted = false;
  let reading = null;

  const status = () => ({ loaded, readError, saving: writing || !!pending, saveError });
  const emitStatus = () => onStatus?.(status());
  const show = (next) => {
    layout = next;
    onLayout?.(next);
  };

  /** Reads the file; while a write is queued or under way, once the queue is empty instead. */
  const refresh = () => {
    if (writing || pending) {
      refreshWanted = true;
      return Promise.resolve(false);
    }
    if (reading) return reading;
    reading = (async () => {
      try {
        const r = await read();
        // an edit made while reading wins; its write reads again afterwards
        if (writing || pending) return (refreshWanted = true), false;
        loaded = true;
        readError = null;
        hash = r.hash ?? null;
        if (!sameLayout(layout, r.layout)) show(r.layout);
        return true;
      } catch (e) {
        readError = e;
        return false;
      } finally {
        reading = null;
        emitStatus();
      }
    })();
    return reading;
  };

  const drain = async () => {
    if (writing) return;
    writing = true;
    emitStatus();
    while (pending) {
      const batch = pending;
      pending = null;
      try {
        hash = (await write(batch.layout, hash)) ?? null;
        saveError = null;
        batch.waiters.forEach((w) => w.resolve());
      } catch (e) {
        const conflict = e instanceof LayoutConflict;
        saveError = conflict ? CONFLICT_ERROR : e;
        // what was not written is dropped (later edits built on it); the file is read again below
        const waiters = [...batch.waiters, ...(pending?.waiters || [])];
        pending = null;
        refreshWanted = true;
        waiters.forEach((w) => w.reject(conflict ? new Error(CONFLICT_ERROR) : e));
      }
    }
    writing = false;
    emitStatus();
    if (refreshWanted) {
      refreshWanted = false;
      await refresh();
    }
  };

  /** Applies an edit to the newest layout, shows it and queues it for writing; resolves once it is written. */
  const update = (fn) => {
    if (!loaded) return Promise.reject(new Error(READ_ERROR));
    const next = fn(layout);
    if (!next || sameLayout(next, layout)) return Promise.resolve();
    show(next);
    const done = new Promise((resolve, reject) => {
      pending = pending || { layout: null, waiters: [] };
      pending.layout = next;
      pending.waiters.push({ resolve, reject });
    });
    emitStatus();
    drain();
    return done;
  };

  return { refresh, update, get: () => layout, status };
}
