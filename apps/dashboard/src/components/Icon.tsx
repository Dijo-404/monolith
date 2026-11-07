import type { ReactNode } from 'react';

/*
 * One authored set on a 24-unit grid: square caps, mitred joins and a constant 1.5px stroke
 * (non-scaling, see `.icon *` in lab.css), so a 14px status glyph and a 28px route node carry
 * the same weight. Domain glyphs name Monolith's own boundaries instead of generic metaphors.
 */
export type IconName =
  // Route boundaries
  | 'app' | 'gate' | 'mix' | 'node' | 'observer' | 'registry'
  // Objects
  | 'wallet' | 'key' | 'book' | 'terminal' | 'code' | 'hash' | 'copy' | 'external' | 'power'
  // Status
  | 'check' | 'cross' | 'dash' | 'alert' | 'info' | 'clock' | 'retry' | 'reset' | 'play'
  // Direction
  | 'arrow-right' | 'arrow-down' | 'chevron-down' | 'menu'
  // Retained names used by the simulated walkthrough
  | 'bolt' | 'shield' | 'lock' | 'eye';

const p = (d: string) => <path d={d} />;
const filled = (d: string) => <path d={d} fill="currentColor" stroke="none" />;

const GLYPHS: Record<IconName, ReactNode> = {
  // A client window with a prompt: the code that issues the read.
  app: <>{p('M3 4.5h18v15H3z')}{p('M3 8.5h18')}{p('M7 12l2.5 2L7 16')}{p('M12 16h4.5')}</>,
  // A checkpoint barrier: policy decides before anything leaves.
  gate: <>{p('M3 7.5h18v4.5H3z')}{p('M8 12l4.5-4.5')}{p('M14.5 12l4.5-4.5')}{p('M6 12v9')}{p('M3.5 21h5')}</>,
  // Shuffled paths: a mixnet re-orders traffic so the source is not carried through.
  mix: <>{p('M3 7h4l10 10h4')}{p('M3 17h4l3.2-3.2')}{p('M13.8 10.2L17 7h4')}{p('M18 4l3 3-3 3')}{p('M18 14l3 3-3 3')}</>,
  // A rack node: the RPC endpoint that answers, and reads, the request.
  node: <>{p('M3 3.5h18v7H3z')}{p('M3 13.5h18v7H3z')}{p('M6.5 7h1.5')}{p('M6.5 17h1.5')}{p('M12 7h5.5')}{p('M12 17h5.5')}</>,
  // The crash-test calibration target: an independent observer measures the run.
  observer: <><circle cx="12" cy="12" r="8.5" />{filled('M12 12V3.5A8.5 8.5 0 0 1 20.5 12z')}{filled('M12 12v8.5A8.5 8.5 0 0 1 3.5 12z')}</>,
  // Stacked ledger: the Arkiv registry.
  registry: <>{p('M4 5.5C4 4 7.6 3 12 3s8 1 8 2.5S16.4 8 12 8 4 7 4 5.5z')}{p('M4 5.5v13C4 20 7.6 21 12 21s8-1 8-2.5v-13')}{p('M4 12c0 1.5 3.6 2.5 8 2.5s8-1 8-2.5')}</>,

  wallet: <>{p('M3 7h18v13H3z')}{p('M5 7l11-3.5V7')}{p('M15 11.5h6v4h-6z')}{p('M17.5 13.5h.5')}</>,
  key: <><circle cx="8" cy="15.5" r="4.5" />{p('M11.2 12.3L20 3.5')}{p('M16.5 7l3 3')}{p('M14 9.5l2 2')}</>,
  book: <>{p('M12 6.5C10.5 5 8.5 4.5 3 4.5v14c5.5 0 7.5.5 9 2 1.5-1.5 3.5-2 9-2v-14c-5.5 0-7.5.5-9 2z')}{p('M12 6.5v14')}</>,
  terminal: <>{p('M3 4h18v16H3z')}{p('M7 9l3 3-3 3')}{p('M12.5 15h4.5')}</>,
  code: <>{p('M8 7l-5 5 5 5')}{p('M16 7l5 5-5 5')}{p('M13.5 4l-3 16')}</>,
  hash: <>{p('M9.5 3L7.5 21')}{p('M16.5 3l-2 18')}{p('M4 8.5h16.5')}{p('M3.5 15.5H20')}</>,
  copy: <>{p('M8.5 8.5h12v12h-12z')}{p('M15.5 8.5v-5h-12v12h5')}</>,
  external: <>{p('M13.5 3.5h7v7')}{p('M20.5 3.5L11 13')}{p('M17.5 14v6.5h-14v-14H10')}</>,
  power: <>{p('M12 3v8')}{p('M6.7 6.5a7.5 7.5 0 1 0 10.6 0')}</>,

  check: p('M4 12.5l5 5L20 6.5'),
  cross: <>{p('M6 6l12 12')}{p('M18 6L6 18')}</>,
  dash: p('M6 12h12'),
  alert: <>{p('M12 3L22 20.5H2z')}{p('M12 10v4.5')}{p('M12 17.25v.5')}</>,
  info: <><circle cx="12" cy="12" r="9" />{p('M12 11v6')}{p('M12 7.25v.5')}</>,
  clock: <><circle cx="12" cy="12" r="9" />{p('M12 7v5.5l3.5 2')}</>,
  retry: <>{p('M20 12a8 8 0 1 1-2.35-5.65')}{p('M20.5 3.5v5h-5')}</>,
  reset: <>{p('M4 12a8 8 0 1 0 2.35-5.65')}{p('M3.5 3.5v5h5')}</>,
  play: filled('M7 4.5v15L19.5 12z'),

  'arrow-right': <>{p('M3.5 12h16')}{p('M13.5 6l6 6-6 6')}</>,
  'arrow-down': <>{p('M12 3.5v16')}{p('M6 13.5l6 6 6-6')}</>,
  'chevron-down': p('M6 9.5l6 6 6-6'),
  menu: <>{p('M3 6.5h18')}{p('M3 12h18')}{p('M3 17.5h18')}</>,

  bolt: p('M13.5 2.5L4.5 13.5h6.5l-1 8 9-11h-6.5z'),
  shield: p('M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z'),
  lock: <>{p('M5 10.5h14V21H5z')}{p('M8 10.5V7a4 4 0 0 1 8 0v3.5')}</>,
  eye: <>{p('M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z')}<circle cx="12" cy="12" r="3" /></>,
};

/** Decorative by default; pass `label` only when the glyph is the sole name of a control. */
export function Icon({ name, size = 18, label }: {
  readonly name: IconName; readonly size?: number; readonly label?: string;
}) {
  return (
    <svg
      className={`icon icon--${name}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      {GLYPHS[name]}
    </svg>
  );
}

/** Decorative faceted monolith; the adjacent wordmark supplies its accessible name. */
export function Mark({ size = 28 }: { readonly size?: number }) {
  return (
    <img
      className="mark"
      src={`${import.meta.env.BASE_URL}assets/brand/monolith-mark.svg`}
      width={size * 0.5}
      height={size}
      alt=""
      aria-hidden="true"
    />
  );
}
