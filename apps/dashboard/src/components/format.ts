export function shortHex(value: string, head = 6, tail = 4): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function relativeMinutes(target: number, now: number): string {
  const minutes = Math.round((target - now) / 60_000);
  if (minutes === 0) return 'now';
  return minutes > 0 ? `in ${minutes} min` : `${-minutes} min ago`;
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}
