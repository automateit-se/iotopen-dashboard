import { useEffect, useState } from 'react';
import { Modal } from '../Modal.jsx';
import { displayName, findImage, imageUrl, installationFiles } from '../../lib/images.js';

/**
 * An image from the installation's files, shown within the widget (whole image, or filling the widget when
 * the layout says "cover"). A click or tap shows it as large as the screen allows.
 */
export function ImageWidget({ w, ctx, iid }) {
  const [state, setState] = useState({ url: null, file: null, err: '' });
  const [open, setOpen] = useState(false);
  const fit = w.layout.fit === 'cover' ? 'cover' : 'contain';

  useEffect(() => {
    let alive = true;
    installationFiles(iid, ctx.fileVersion || 0)
      .then((files) => {
        const file = findImage(files, w.layout);
        if (!file) return alive && setState({ url: null, file: null, err: w.layout.file ? `Bilden ${displayName(w.layout.file)} finns inte längre i installationen.` : 'Ingen bild vald.' });
        return imageUrl(file).then((url) => alive && setState({ url, file, err: '' }));
      })
      .catch((e) => alive && setState({ url: null, file: null, err: e.status === 403 ? 'Saknar behörighet till installationens filer' : 'Bilden kunde inte läsas' }));
    return () => {
      alive = false;
    };
  }, [iid, ctx.fileVersion, w.layout.file, w.layout.fileId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.err) return <div className="muted small">{state.err}</div>;
  if (!state.url) return <div className="muted small">Läser bilden…</div>;
  const alt = String(w.layout.label || '').trim() || displayName(state.file?.name);
  return (
    <>
      <button type="button" className={`w-image fit-${fit}`} onClick={() => setOpen(true)} aria-label={`Visa ${alt} större`}>
        <img src={state.url} alt={alt} draggable="false" />
      </button>
      {open && (
        <Modal title={alt} onClose={() => setOpen(false)}>
          <img className="w-image-full" src={state.url} alt={alt} />
        </Modal>
      )}
    </>
  );
}
