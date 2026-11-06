export type IconName =
  | 'play'
  | 'bolt'
  | 'shield'
  | 'lock'
  | 'alert'
  | 'info'
  | 'retry'
  | 'check'
  | 'cross'
  | 'dash'
  | 'reset'
  | 'eye'
  | 'arrow-right'
  | 'arrow-down'
  | 'clock';

const PATHS: Record<IconName, string> = {
  play: 'M7 5.5v9l7.5-4.5z',
  bolt: 'M11 2.5 4.5 11h5l-1 6.5L15 9h-5z',
  shield: 'M10 2.5 4 5v4.6c0 3.7 2.6 6.6 6 7.9 3.4-1.3 6-4.2 6-7.9V5z',
  lock: 'M5.5 9h9v7.5h-9zM7.5 9V6.5a2.5 2.5 0 0 1 5 0V9',
  alert: 'M10 3 2.8 16h14.4zM10 8v4M10 14.2v.3',
  info: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 9.2V14M10 6.3v.3',
  retry: 'M15.5 10a5.5 5.5 0 1 1-1.7-4M14 2.8V6.4h-3.6',
  check: 'm4.5 10.5 3.5 3.5 7.5-8',
  cross: 'm5.5 5.5 9 9m0-9-9 9',
  dash: 'M5.5 10h9',
  reset: 'M4.5 10a5.5 5.5 0 1 0 1.7-4M6 2.8V6.4h3.6',
  eye: 'M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5zM10 12.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z',
  'arrow-right': 'M4.5 10h11m-4.5-4.5L15.5 10 11 14.5',
  'arrow-down': 'M10 4.5v11m-4.5-4.5L10 15.5l4.5-4.5',
  clock: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 6.5V10l2.5 1.5',
};

const FILLED = new Set<IconName>(['play']);

export function Icon({ name, size = 18 }: { readonly name: IconName; readonly size?: number }) {
  const filled = FILLED.has(name);
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The Monolith mark: a dark slab in 1 : 2.25 proportion with a seam of light. */
export function Mark({ size = 28 }: { readonly size?: number }) {
  return (
    <svg className="mark" width={size * 0.6} height={size} viewBox="0 0 15 25" aria-hidden="true" focusable="false">
      <rect x="0.5" y="0.5" width="14" height="24" rx="2.5" fill="#17141f" />
      <path d="M3.5 8.5h8" stroke="#b9c3ff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
