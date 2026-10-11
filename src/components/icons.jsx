// Small stroke icon set. The names are what goes into meta "dashboard.icon".
const P = {
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  thermometer: 'M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z',
  droplet: 'M12 2.7s6 6.3 6 11a6 6 0 0 1-12 0c0-4.7 6-11 6-11z',
  power: 'M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0',
  lightbulb: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z',
  gauge: 'M12 14l4-4M3.3 19a10 10 0 1 1 17.4 0',
  door: 'M4 22h16M6 22V3h12v19M14 12h.01',
  lift: 'M5 3h14v18H5zM9 9l3-3 3 3M9 15l3 3 3-3',
  wind: 'M3 8h10a3 3 0 1 0-3-3M3 16h14a3 3 0 1 1-3 3M3 12h18',
  home: 'M3 11 12 3l9 8M5 10v11h14V10',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  alert: 'M12 3 2 21h20zM12 10v5M12 18h.01',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  fan: 'M12 12m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0M12 10c0-5 4-7 6-5s-1 6-6 5M14 12c5 0 7 4 5 6s-6-1-5-6M10 12c-5 0-7-4-5-6s6 1 5 6',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  signal: 'M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16',
  battery: 'M2 7h16v10H2zM22 11v2',
  device: 'M4 4h16v12H4zM8 20h8M12 16v4',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  close: 'M6 6l12 12M18 6 6 18',
  grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.8H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  back: 'M15 18l-6-6 6-6',
  logout: 'M9 21H5V3h4M16 17l5-5-5-5M21 12H9',
};

export const ICON_NAMES = Object.keys(P).filter((k) => !['plus', 'edit', 'close', 'grip', 'settings', 'back', 'logout'].includes(k));

export function Icon({ name, size = 20, className = '', title }) {
  const d = P[name] || P.device;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : 'true'} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={d} />
    </svg>
  );
}
