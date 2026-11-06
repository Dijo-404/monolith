import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Comparison } from '../components/Comparison.js';
import { Guide } from '../components/Guide.js';
import { Header } from '../components/Header.js';
import { StageCard } from '../components/StageCard.js';
import type { StageTarget } from '../components/stage/Stage.js';
import type { StageFlight, StageScene } from '../components/stage/renderer.js';
import { UnderTheHood } from '../components/UnderTheHood.js';
import { commandActions, guideSteps, type GuideCommand } from './guide.js';
import { useLab, usePrefersReducedMotion } from './use-lab.js';

export function LabApp({ observerUrl }: { readonly observerUrl: string }) {
  const { state, dispatch, checks } = useLab();
  const reducedMotion = usePrefersReducedMotion();
  const [active, setActive] = useState(0);
  const [section, setSection] = useState<'demo' | 'details'>('demo');
  const transportRef = useRef<HTMLElement>(null);
  const focusTimer = useRef(0);

  const steps = useMemo(() => guideSteps(state), [state]);

  const { worker, privateMode, leakInjected, observer } = state;
  const scene = useMemo<StageScene>(
    () => ({
      workerState: worker.state,
      hopsReady: worker.network === 'Passthrough' ? 0 : worker.hopsReady,
      passthrough: worker.network === 'Passthrough',
      privateMode,
      leakInjected,
      observerUp: observer === 'available',
    }),
    [worker.state, worker.hopsReady, worker.network, privateMode, leakInjected, observer],
  );

  const flights = useMemo<StageFlight[]>(
    () =>
      state.reads.map((read) => ({
        id: read.id,
        lane: read.lane,
        start: read.requestedAt + read.startDelayMs,
        durationMs: read.outcome === 'blocked' ? null : read.durationMs,
      })),
    [state.reads],
  );

  const onCommand = useCallback(
    (command: GuideCommand) => {
      for (const action of commandActions(command, Date.now())) dispatch(action);
    },
    [dispatch],
  );

  // Keep the header's section pill in step with the scroll position.
  useEffect(() => {
    const target = document.getElementById('under-the-hood');
    if (target === null) return;
    const observerApi = new IntersectionObserver(
      ([entry]) => setSection(entry?.isIntersecting ? 'details' : 'demo'),
      { rootMargin: '-45% 0px -45% 0px' },
    );
    observerApi.observe(target);
    return () => observerApi.disconnect();
  }, []);

  const select = useCallback(
    (target: StageTarget) => {
      const behavior = reducedMotion ? 'auto' : 'smooth';
      if (target === 'endpoint') {
        document.querySelector('.compare')?.scrollIntoView({ behavior, block: 'nearest' });
        return;
      }
      dispatch({ type: 'focus', target: 'transport' });
      transportRef.current?.scrollIntoView({ behavior, block: 'center' });
      window.clearTimeout(focusTimer.current);
      focusTimer.current = window.setTimeout(() => dispatch({ type: 'focus', target: null }), 1800);
    },
    [dispatch, reducedMotion],
  );

  return (
    <>
      <Header section={section} />
      <main>
        <h1 className="visually-hidden">Monolith Leak Lab</h1>
        <section id="demo" className="hero" aria-label="Guided demo">
          <Guide steps={steps} active={active} onSelect={setActive} onCommand={onCommand} />
          <div className="stage-col">
            <StageCard state={state} scene={scene} flights={flights} reducedMotion={reducedMotion} onSelect={select} />
            <Comparison direct={state.observed.direct} anon={state.observed.anon} />
          </div>
        </section>

        <UnderTheHood
          state={state}
          checks={checks}
          observerUrl={observerUrl}
          transportRef={transportRef}
          onScenario={(scenario) => dispatch({ type: 'load-scenario', scenario, now: Date.now() })}
          onPrivateMode={(on) => dispatch({ type: 'set-private-mode', on })}
          onLeak={(on) => dispatch({ type: 'set-leak', on, now: Date.now() })}
          onDirect={() => dispatch({ type: 'confirm-direct', now: Date.now() })}
          onRetry={() => dispatch({ type: 'retry-worker' })}
          onNewRun={() => dispatch({ type: 'new-run' })}
        />
      </main>
    </>
  );
}
