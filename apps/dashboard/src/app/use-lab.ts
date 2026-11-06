import { useEffect, useMemo, useReducer, useRef, useSyncExternalStore } from 'react';
import { DEFAULT_SCENARIO, FIXTURE_TIMINGS } from './lab-fixtures.js';
import { createLabState, deriveChecks, labReducer } from './lab-reducer.js';

/**
 * Owns the fixture lab state and the timers that stand in for real worker and network latency.
 * Every scheduled settlement carries the epoch it was created in; loading a scenario or starting
 * a new run invalidates outstanding work instead of letting stale success change the UI.
 */
export function useLab() {
  const [state, dispatch] = useReducer(labReducer, DEFAULT_SCENARIO, (scenario) =>
    createLabState(scenario, Date.now()),
  );
  const scheduled = useRef(new Map<string, number>());

  useEffect(() => {
    const timers = scheduled.current;
    for (const read of state.reads) {
      if (read.outcome !== 'in-flight' || read.durationMs === null || timers.has(read.id)) continue;
      const due = read.requestedAt + read.startDelayMs + read.durationMs - Date.now();
      const { epoch } = state;
      const handle = window.setTimeout(() => {
        timers.delete(read.id);
        dispatch({ type: 'read-settled', epoch, id: read.id, now: Date.now() });
      }, Math.max(0, due));
      timers.set(read.id, handle);
    }
  }, [state]);

  useEffect(() => {
    const timers = scheduled.current;
    return () => {
      for (const handle of timers.values()) window.clearTimeout(handle);
      timers.clear();
    };
  }, [state.epoch]);

  const { epoch } = state;
  const { state: workerState, hopsReady } = state.worker;
  useEffect(() => {
    if (workerState !== 'BOOTSTRAPPING') return;
    const handle = window.setTimeout(
      () => dispatch({ type: 'worker-hop', epoch }),
      FIXTURE_TIMINGS.hopIntervalMs,
    );
    return () => window.clearTimeout(handle);
  }, [workerState, hopsReady, epoch]);

  const checks = useMemo(() => deriveChecks(state), [state]);
  return { state, dispatch, checks };
}

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia(reducedMotionQuery);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(reducedMotionQuery).matches,
    () => false,
  );
}

function subscribeClock(onChange: () => void) {
  const handle = window.setInterval(onChange, 15_000);
  return () => window.clearInterval(handle);
}

let clockSnapshot = Date.now();
function readClock() {
  const now = Date.now();
  if (now - clockSnapshot >= 15_000) clockSnapshot = now;
  return clockSnapshot;
}

/** A coarse wall clock for freshness labels; it updates every 15 seconds. */
export function useCoarseNow(): number {
  return useSyncExternalStore(subscribeClock, readClock, readClock);
}
