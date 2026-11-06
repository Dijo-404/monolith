import type { ReactNode } from 'react';

export type TagTone = 'sim' | 'good' | 'exposed' | 'protected' | 'neutral';

/** A quiet status pill. `sim` marks fixture data; it is the only amber in the interface. */
export function Tag({ tone = 'neutral', children, title }: { readonly tone?: TagTone; readonly children: ReactNode; readonly title?: string }) {
  return (
    <span className={`tag tag--${tone}`} title={title}>
      {tone === 'sim' && <span className="dot dot--sim" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function SimulatedTag() {
  return (
    <Tag tone="sim" title="Fixture data. Nothing here was observed on a network.">
      Simulated
    </Tag>
  );
}
