import { useEffect, useState } from 'react';
import { readBackground } from '../lib/dashboard.js';

// object URLs per installation and page, kept while the app is open so switching pages does not download again
const cache = new Map(); // "<iid>/<page id>" -> { hash, url }

/**
 * Object URL of a page's background image, null when it has none. Looked up again when `version` changes (the
 * layout object: a new image is always saved together with the layout), downloaded only when its hash changed.
 */
export function useBackground(iid, pageId, wanted, version) {
  const key = `${iid}/${pageId}`;
  const [url, setUrl] = useState(() => (wanted ? cache.get(key)?.url || null : null));
  useEffect(() => {
    if (!wanted) return setUrl(null);
    let alive = true;
    setUrl(cache.get(key)?.url || null);
    readBackground(iid, pageId, cache.get(key)?.hash)
      .then((next) => {
        const cur = cache.get(key);
        if (!next) {
          if (cur) URL.revokeObjectURL(cur.url);
          cache.delete(key);
        } else if (next.blob) {
          if (cur) URL.revokeObjectURL(cur.url);
          cache.set(key, { hash: next.hash, url: URL.createObjectURL(next.blob) });
        }
        if (alive) setUrl(cache.get(key)?.url || null);
      })
      .catch(() => alive && setUrl(cache.get(key)?.url || null));
    return () => {
      alive = false;
    };
  }, [iid, pageId, key, wanted, version]);
  return url;
}
