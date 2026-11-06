import type { StageFlight, StageScene } from './renderer.js';
import type { StageTarget } from './Stage.js';

interface StageFallbackProps {
  readonly scene: StageScene;
  readonly flights: readonly StageFlight[];
  readonly onSelect: (target: StageTarget) => void;
}

/** Static schematic of the same routes for browsers without WebGL2. */
export function StageFallback({ scene, flights, onSelect }: StageFallbackProps) {
  const active = new Set(flights.filter((flight) => flight.durationMs !== null).map((flight) => flight.lane));
  const blocked = scene.workerState === 'BLOCKED' || scene.workerState === 'CLOSED';
  return (
    <div className="stage-fallback">
      <svg viewBox="0 0 800 360" role="img" aria-label="Route schematic: the Anon-RPC lane passes three relays, the direct lane goes straight to the RPC endpoint, and the Whitechain lane is public and not enabled.">
        <path className="fallback-lane fallback-lane--settlement" d="M 120 190 C 220 300 360 320 470 316" />
        <path
          className={`fallback-lane fallback-lane--direct${active.has('direct') ? ' is-active' : ''}${scene.privateMode ? '' : ' is-open'}`}
          d="M 120 190 C 300 230 520 230 668 214"
        />
        {!scene.passthrough && (
          <path
            className={`fallback-lane fallback-lane--anon${active.has('anon') ? ' is-active' : ''}${blocked ? ' is-blocked' : ''}`}
            d="M 120 190 C 180 90 300 70 400 64 C 500 60 600 90 668 140"
          />
        )}
        {scene.passthrough && (
          <path className={`fallback-lane fallback-lane--passthrough${active.has('passthrough') ? ' is-active' : ''}`} d="M 120 190 C 300 130 520 130 668 150" />
        )}
        {scene.leakInjected && (
          <path className={`fallback-lane fallback-lane--leak${active.has('leak') ? ' is-active' : ''}`} d="M 170 280 C 360 290 560 270 668 250" />
        )}
        {!scene.passthrough &&
          [
            [262, 86],
            [400, 64],
            [540, 82],
          ].map(([x, y], i) => (
            <rect
              key={i}
              className={`fallback-relay${i < scene.hopsReady ? ' is-ready' : ''}`}
              x={(x ?? 0) - 9}
              y={(y ?? 0) - 9}
              width="18"
              height="18"
              transform={`rotate(45 ${x} ${y})`}
            />
          ))}
        <rect className="fallback-ledger" x="456" y="304" width="40" height="22" rx="3" />
        {scene.leakInjected && <rect className="fallback-widget" x="150" y="268" width="36" height="22" rx="3" />}
        <circle className={`fallback-client${blocked ? ' is-blocked' : ''}`} cx="120" cy="190" r="26" />
        <rect className="fallback-slab" x="668" y="40" width="64" height="290" rx="2" />
      </svg>
      <div className="stage-fallback__actions">
        <button type="button" className="stage-label stage-label--neutral stage-label--action" onClick={() => onSelect('transport')}>
          Your browser and worker
        </button>
        <button type="button" className="stage-label stage-label--neutral stage-label--action" onClick={() => onSelect('endpoint')}>
          RPC endpoint
        </button>
      </div>
      <p className="stage-fallback__note">WebGL2 is unavailable, so this schematic stands in for the 3D stage.</p>
    </div>
  );
}
