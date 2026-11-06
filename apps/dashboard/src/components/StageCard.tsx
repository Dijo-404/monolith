import type { LabState } from '../app/lab-model.js';
import { Stage, type StageTarget } from './stage/Stage.js';
import type { StageFlight, StageScene } from './stage/renderer.js';

const WORKER_WORDS: Record<LabState['worker']['state'], string> = {
  BOOTSTRAPPING: 'Starting',
  READY: 'Ready',
  DEGRADED: 'Degraded',
  BLOCKED: 'Offline',
  CLOSED: 'Closed',
};

export function StageCard({
  state,
  scene,
  flights,
  reducedMotion,
  onSelect,
}: {
  readonly state: LabState;
  readonly scene: StageScene;
  readonly flights: readonly StageFlight[];
  readonly reducedMotion: boolean;
  readonly onSelect: (target: StageTarget) => void;
}) {
  const { worker, registry } = state;
  const passthrough = worker.network === 'Passthrough';
  return (
    <section className="request-workspace" aria-label="Interactive request explanation">
      <Stage scene={scene} flights={flights} reducedMotion={reducedMotion} onSelect={(target) => {
        if (target === 'endpoint') {
          document.getElementById('registry-title')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
        } else onSelect(target);
      }} />
      <p className="request-workspace__status">
        <span className={`dot dot--state-${worker.state.toLowerCase()}`} aria-hidden="true" />
        {passthrough ? 'Passthrough worker' : 'Anon-RPC worker'}
        <strong>{passthrough ? 'Not anonymized' : WORKER_WORDS[worker.state]}</strong>
        <span className="request-workspace__context">
        {registry.endpoint.chainName} · {registry.status === 'fresh' ? 'registry fresh' : 'registry expired'}
        </span>
        <span className="request-workspace__mode">Simulated lab</span>
      </p>
    </section>
  );
}
