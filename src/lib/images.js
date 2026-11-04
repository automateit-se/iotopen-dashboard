// The installation's images (IoT Open installation files) for the image widget. An image widget shows one file,
// chosen by name so that replacing the file in IoT Open keeps the widget. Files named "dashboard-*" are also kept
// by the edge app "Lokal dashboard", so those work in local mode without internet.

import { lynx } from '../api/lynx.js';

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|svg|avif|bmp)$/i;
export const LOCAL_PREFIX = 'dashboard-image-';

/** Whether an installation file is an image (by its type, else by its name). */
export const isImageFile = (f) => /^image\//i.test(String(f?.mime || '')) || IMAGE_EXT.test(String(f?.name || ''));

/** The installation's image files, newest first; the dashboard's own logo and background images left out. */
export function imageFiles(files) {
  return (files || [])
    .filter(isImageFile)
    .filter((f) => !/^dashboard-(logo|bg-)/.test(String(f.name || '')))
    .sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0));
}

/** The file an image widget shows: by name (the newest of that name), else by id. */
export function findImage(files, ref) {
  if (!ref) return null;
  const all = imageFiles(files);
  return all.find((f) => f.name === ref.file) || (ref.fileId != null ? all.find((f) => String(f.id) === String(ref.fileId)) : null) || null;
}

/** A file name for an uploaded image: "dashboard-image-<name>.jpg", kept by the local dashboard too. */
export function uploadName(original) {
  const base = String(original || 'bild')
    .replace(/\.[^.]*$/, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${LOCAL_PREFIX}${base || 'bild'}.jpg`;
}

/** A readable name for a file: without the prefix and extension, dashes as spaces. */
export const displayName = (name) =>
  String(name || '')
    .replace(new RegExp(`^${LOCAL_PREFIX}`), '')
    .replace(/\.[^.]*$/, '')
    .replace(/[-_]+/g, ' ')
    .trim() || String(name || '');

// object URLs by file hash, kept while the app is open (the same image on several widgets or pages is read once)
const urls = new Map(); // hash -> Promise<string>

const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp' };
/** The image type to show a file as: its own, else from its name (a download may come as octet-stream). */
export const imageType = (f) => (/^image\//i.test(String(f?.mime || '')) ? f.mime : TYPES[String(f?.name || '').split('.').pop().toLowerCase()] || 'image/jpeg');

/** An object URL for a file's content, downloaded once per hash. */
export function imageUrl(file) {
  if (!file?.hash) return Promise.reject(new Error('Filen saknar innehåll'));
  if (!urls.has(file.hash)) {
    const p = lynx.downloadFile(file.hash).then(async (res) => URL.createObjectURL(new Blob([await res.blob()], { type: imageType(file) })));
    p.catch(() => urls.delete(file.hash));
    urls.set(file.hash, p);
  }
  return urls.get(file.hash);
}

/** Installation files, read once per change (the file list is shared by all image widgets on the page). */
const lists = new Map(); // "<iid>/<version>" -> Promise<file[]>
export function installationFiles(iid, version) {
  const key = `${iid}/${version}`;
  if (!lists.has(key)) {
    for (const k of lists.keys()) if (k.startsWith(`${iid}/`)) lists.delete(k);
    const p = lynx.files(iid).then((f) => f || []);
    p.catch(() => lists.delete(key));
    lists.set(key, p);
  }
  return lists.get(key);
}
