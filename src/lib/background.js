// Background image per page. The image is a file on the installation, "dashboard-bg-<page id>.jpg", made
// smaller in the browser before it is uploaded; the page entry in the layout file holds how it is shown:
//
//   background: { dim, blur, opacity, glass }
//     dim      darkening over the image, 0-80 (%)
//     blur     the image itself blurred (true/false)
//     opacity  how much the widgets cover the image, 10-60 (%) - lower = more of the image shows through
//     glass    frosted glass behind the widgets (backdrop-filter) (true/false)
//
// No background entry = the page looks as without an image.

export const BG_MAX_WIDTH = 1920;
export const BG_MAX_HEIGHT = 1920;
export const BG_MAX_BYTES = 600 * 1024; // what is stored after the compression
export const BG_DEFAULTS = { dim: 30, blur: false, opacity: 35, glass: true };
export const DIM_RANGE = [0, 80];
export const OPACITY_RANGE = [10, 60];

export const backgroundFile = (pageId) => `dashboard-bg-${pageId}.jpg`;

const clamp = (v, [lo, hi], def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : def;
};

/** The page's background settings with defaults and limits applied, or null when the page has no image. */
export function backgroundOf(page) {
  const b = page?.background;
  if (!b || typeof b !== 'object') return null;
  return {
    dim: clamp(b.dim, DIM_RANGE, BG_DEFAULTS.dim),
    blur: b.blur === true,
    opacity: clamp(b.opacity, OPACITY_RANGE, BG_DEFAULTS.opacity),
    glass: b.glass !== false,
  };
}

/** The size an image is scaled down to (never up), aspect ratio kept. */
export function fitSize(width, height, maxW = BG_MAX_WIDTH, maxH = BG_MAX_HEIGHT) {
  const k = Math.min(1, maxW / width, maxH / height);
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/**
 * Darkening that makes white text readable on an image of the given mean luminance (0-1): a dark image needs
 * little, a bright one more. In steps of 5, within the dim range.
 */
export function suggestDim(luminance) {
  const l = Math.min(1, Math.max(0, Number(luminance) || 0));
  // aim for a mean luminance of about 0.18 under the overlay
  const dim = l <= 0.18 ? 10 : (1 - 0.18 / l) * 100;
  return Math.min(DIM_RANGE[1] - 10, Math.max(10, Math.round(dim / 5) * 5));
}

/** Mean relative luminance (0-1) of RGBA pixel data. */
export function meanLuminance(data) {
  const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    sum += 0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]);
    n++;
  }
  return n ? sum / n : 0;
}

/**
 * Makes a picked image ready for upload: scaled down to at most 1920 px, saved as JPEG with lower quality until
 * it is below BG_MAX_BYTES. Resolves to { blob, width, height, luminance }.
 */
export async function prepareBackground(file) {
  if (!/^image\//.test(file.type || '')) throw new Error('Filen är ingen bild.');
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('Bilden kunde inte läsas. Välj en JPEG-, PNG- eller WebP-bild.');
  }
  const { width, height } = fitSize(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  g.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  // the brightness from a small copy is enough for the suggestion
  const small = document.createElement('canvas');
  small.width = 32;
  small.height = 32;
  const sg = small.getContext('2d');
  sg.drawImage(canvas, 0, 0, 32, 32);
  const luminance = meanLuminance(sg.getImageData(0, 0, 32, 32).data);
  let blob = null;
  for (const q of [0.82, 0.72, 0.62, 0.5]) {
    blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', q));
    if (blob && blob.size <= BG_MAX_BYTES) break;
  }
  if (!blob) throw new Error('Bilden kunde inte komprimeras.');
  if (blob.size > BG_MAX_BYTES) throw new Error(`Bilden blir ${Math.round(blob.size / 1024)} kB, max är ${BG_MAX_BYTES / 1024} kB. Välj en enklare bild.`);
  return { blob, width, height, luminance };
}
