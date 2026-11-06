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
    <section className="stage-card" aria-label="Route stage">
      <Stage scene={scene} flights={flights} reducedMotion={reducedMotion} onSelect={onSelect} />
      <p className="hud hud--tl">
        <span className={`dot dot--state-${worker.state.toLowerCase()}`} aria-hidden="true" />
        {passthrough ? 'Passthrough worker' : 'Anon-RPC worker'}
        <strong>{passthrough ? 'Not anonymized' : WORKER_WORDS[worker.state]}</strong>
      </p>
      <p className="hud hud--tr">
        {registry.endpoint.chainName} · {registry.status === 'fresh' ? 'registry fresh' : 'registry expired'}
      </p>
      <p className="hud hud--bl">
        <span className="hud__legend">
          <span className="hud__line hud__line--anon" aria-hidden="true" />
          Private route
        </span>
        <span className="hud__legend">
          <span className="hud__line hud__line--direct" aria-hidden="true" />
          Direct route
        </span>
      </p>
      <p className="hud hud--br">Simulated</p>
    </section>
  );
}
