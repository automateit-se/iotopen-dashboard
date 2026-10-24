// What IoT Open can store as a metadata value: its tables keep values as varchar(1024) in MariaDB's latin1,
// which is Windows-1252. Longer values, and characters outside that set (emoji, arrows, most non-Latin scripts),
// are refused or stored wrongly, so the dashboard checks before it writes anything.

export const META_MAX_LENGTH = 1024;

// Windows-1252 0x80-0x9F, as MariaDB's latin1 maps them (the five undefined bytes map to themselves)
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ\u0081\u008d\u008f\u0090\u009d');

const storable = (ch) => {
  const c = ch.codePointAt(0);
  return c <= 0x7f || (c >= 0xa0 && c <= 0xff) || CP1252_EXTRA.has(ch);
};

/** { length, tooLong, badChars } for a value: badChars are the distinct characters IoT Open cannot store. */
export function checkMetaValue(value) {
  const chars = [...String(value ?? '')];
  const bad = [...new Set(chars.filter((ch) => !storable(ch)))];
  return { length: chars.length, tooLong: chars.length > META_MAX_LENGTH, badChars: bad };
}

const LABELS = {
  'dashboard.title': 'Titeln',
  'dashboard.admins': 'Listan med administratörer',
  'dashboard.widget': 'Widgettypen',
  'dashboard.nickname': 'Namnet',
  'dashboard.timeline': 'Tidslinjens namn',
  'dashboard.chart': 'Grafens namn',
  'dashboard.tracker': 'Kartans namn',
  'dashboard.icon': 'Ikonen',
  'dashboard.color': 'Färgen',
};

/** A message for the user when a value cannot be stored as metadata in IoT Open, else null. */
export function metaProblem(key, value) {
  const { length, tooLong, badChars } = checkMetaValue(value);
  const what = LABELS[key] || `Värdet för ${key}`;
  if (badChars.length) {
    const shown = badChars.slice(0, 5).join(' ');
    return `${what} innehåller tecken som IoT Open inte kan spara: ${shown}${badChars.length > 5 ? ' …' : ''}. Ta bort dem (emoji, pilar och tecken utanför västeuropeiska alfabet stöds inte).`;
  }
  if (tooLong) return `${what} är ${length} tecken långt; IoT Open sparar högst ${META_MAX_LENGTH}.`;
  return null;
}

/** Throws the first problem among the values that are about to be written, so nothing is written half-way. */
export function assertStorable(entries) {
  for (const [key, value] of entries) {
    const p = metaProblem(key, value);
    if (p) throw new Error(p);
  }
}
