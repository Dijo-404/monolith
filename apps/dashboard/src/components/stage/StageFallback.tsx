import type { StageFlight, StageScene } from './renderer.js';
import type { StageTarget } from './Stage.js';

interface StageFallbackProps {
  readonly scene: StageScene;
  readonly flights: readonly StageFlight[];
  readonly onSelect: (target: StageTarget) => void;
  readonly live?: boolean;
}

/** Static schematic of the same routes for browsers without WebGL2. */
export function StageFallback({ scene, flights, onSelect, live = false }: StageFallbackProps) {
  const active = new Set(flights.filter((flight) => flight.durationMs !== null).map((flight) => flight.lane));
  const blocked = scene.workerState === 'BLOCKED' || scene.workerState === 'CLOSED';
  return (
    <div className="stage-fallback">
      <svg viewBox="0 0 800 360" role="img" aria-label={live
        ? 'Illustrative private and direct network paths. Hop count is not measured; actual outcomes are listed below.'
        : 'Simulated route schematic: a browser device, a private relay path, a separate direct path and an RPC endpoint. The status widget appears only when its leak is injected.'}>
        {!live && <path className="fallback-lane fallback-lane--settlement" d="M 120 190 C 220 300 360 320 470 316" />}
        <path
          className={`fallback-lane fallback-lane--direct${active.has('direct') ? ' is-active' : ''}${scene.privateMode ? '' : ' is-open'}`}
          d="M 160 190 C 300 230 520 230 692 214"
        />
        {!scene.passthrough && (
          <path
            className={`fallback-lane fallback-lane--anon${active.has('anon') ? ' is-active' : ''}${blocked ? ' is-blocked' : ''}`}
            d="M 160 190 C 180 90 300 70 400 64 C 500 60 600 90 692 140"
          />
        )}
        {scene.passthrough && (
          <path className={`fallback-lane fallback-lane--passthrough${active.has('passthrough') ? ' is-active' : ''}`} d="M 160 190 C 300 130 520 130 692 150" />
        )}
        {scene.leakInjected && (
          <path className={`fallback-lane fallback-lane--leak${active.has('leak') ? ' is-active' : ''}`} d="M 170 280 C 360 290 560 270 692 250" />
        )}
        {!scene.passthrough &&
          [
            [262, 86],
            [400, 64],
            [540, 82],
          ].map(([x, y], i) => (
            <circle
              key={i}
              className={`fallback-relay${i < scene.hopsReady ? ' is-ready' : ''}`}
              cx={x}
              cy={y}
              r="23"
            />
          ))}
        {!live && <rect className="fallback-ledger" x="456" y="304" width="40" height="22" rx="3" />}
        {scene.leakInjected && <rect className="fallback-widget" x="150" y="268" width="36" height="22" rx="3" />}
        <rect className={`fallback-client${blocked ? ' is-blocked' : ''}`} x="68" y="144" width="104" height="86" rx="15" />
        <path className="fallback-browser-line" d="M 78 165 H 162 M 87 182 H 119 M 87 196 H 144 M 87 210 H 132" />
        <rect className="fallback-slab" x="646" y="40" width="106" height="290" rx="24" />
        <rect className="fallback-aperture" x="666" y="63" width="66" height="244" rx="13" />
      </svg>
      <div className="stage-fallback__actions">
        <button type="button" className="stage-label stage-label--neutral stage-label--action" aria-label="Your browser and worker" onClick={() => onSelect('transport')}>
          Browser &amp; worker
        </button>
        <button type="button" className="stage-label stage-label--neutral stage-label--action" onClick={() => onSelect('endpoint')}>
          RPC endpoint
        </button>
      </div>
      <p className="stage-fallback__note">WebGL2 is unavailable, so this schematic stands in for the 3D stage.</p>
    </div>
  );
}
