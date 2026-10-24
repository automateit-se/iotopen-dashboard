// Miniature drawings of the widget types, shown in "Lägg till widget" so it is easy to see what can be made.
// Colours follow the theme: --data for the widget colour, --off / --surface-2 for the inactive parts.

const DRAW = {
  value: (
    <text x="32" y="27" textAnchor="middle" className="th-text">
      21,5°
    </text>
  ),
  chart: <path d="M6 30 L16 22 L24 26 L34 12 L44 18 L58 8" className="th-line" />,
  gauge: (
    <>
      <path d="M14 32 A18 18 0 0 1 50 32" className="th-track" />
      <path d="M14 32 A18 18 0 0 1 41 16.4" className="th-line" />
    </>
  ),
  switch: (
    <>
      <rect x="18" y="12" width="28" height="16" rx="8" className="th-fill" />
      <circle cx="38" cy="20" r="5.5" className="th-knob" />
    </>
  ),
  status: (
    <>
      <circle cx="20" cy="20" r="6" className="th-fill" />
      <rect x="31" y="16" width="22" height="8" rx="2" className="th-off" />
    </>
  ),
  number: (
    <>
      <rect x="8" y="18.5" width="48" height="3" rx="1.5" className="th-off" />
      <rect x="8" y="18.5" width="30" height="3" rx="1.5" className="th-fill" />
      <circle cx="38" cy="20" r="5" className="th-fill" />
    </>
  ),
  button: (
    <>
      <circle cx="32" cy="20" r="13" className="th-fill" />
      <path d="M27 21a5 5 0 0 1 10 0c0 3 1.5 4 1.5 4h-13s1.5-1 1.5-4M31 27.5a1.2 1.2 0 0 0 2 0" className="th-knob-line" />
    </>
  ),
  consumption: (
    <>
      {[
        [8, 14],
        [16, 20],
        [24, 10],
        [32, 17],
        [40, 22],
        [48, 13],
      ].map(([x, h]) => (
        <rect key={x} x={x} y={33 - h} width="6" height={h} rx="1" className="th-fill" />
      ))}
      <rect x="56" y="27" width="6" height="6" rx="1" className="th-off" />
    </>
  ),
  sum: (
    <>
      {[6, 26, 46].map((x) => (
        <g key={x}>
          <rect x={x} y="10" width="12" height="9" rx="2" className="th-fill" />
          <rect x={x} y="24" width="12" height="3" rx="1.5" className="th-off" />
        </g>
      ))}
    </>
  ),
  media: (
    <>
      <rect x="8" y="7" width="12" height="12" rx="2" className="th-off" />
      <rect x="24" y="8" width="30" height="4" rx="2" className="th-fill" />
      <rect x="24" y="15" width="20" height="3" rx="1.5" className="th-off" />
      <path d="M10 25v9l7-4.5z" className="th-fill" />
      <rect x="24" y="28.5" width="32" height="3" rx="1.5" className="th-off" />
      <rect x="24" y="28.5" width="18" height="3" rx="1.5" className="th-fill" />
    </>
  ),
  card: (
    <>
      {[10, 20, 30].map((y) => (
        <g key={y}>
          <rect x="8" y={y - 2} width="22" height="4" rx="2" className="th-off" />
          <rect x="40" y={y - 2} width="16" height="4" rx="2" className="th-fill" />
        </g>
      ))}
    </>
  ),
};

export function WidgetThumb({ type }) {
  return (
    <svg className="widget-thumb" viewBox="0 0 64 40" aria-hidden="true">
      {DRAW[type]}
    </svg>
  );
}
