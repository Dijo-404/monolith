export type View = 'live' | 'simulated' | 'docs';

/** `?page=docs` opens the documentation; `?mode=simulated` the offline walkthrough; otherwise live. */
export function resolveView(search: string): View {
  const params = new URLSearchParams(search);
  if (params.get('page') === 'docs') return 'docs';
  return params.get('mode') === 'simulated' ? 'simulated' : 'live';
}
