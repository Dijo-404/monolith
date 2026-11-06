import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { StageFallback } from './StageFallback.js';
import {
  StageRenderer,
  type AnchorPositions,
  type StageFlight,
  type StageInsets,
  type StageScene,
} from './renderer.js';
import type { AnchorId } from './scene-layout.js';
import { Icon } from '../Icon.js';

export type StageTarget = 'transport' | 'endpoint';

export interface StageProps {
  readonly scene: StageScene;
  readonly flights: readonly StageFlight[];
  readonly reducedMotion: boolean;
  /** HUD elements that may sit over the stage; the scene is framed in the space they leave. */
  readonly overlays?: ReadonlyArray<RefObject<HTMLElement | null>>;
  /** Optional element joined to the slab by a leader line when both are visible. */
  readonly plaque?: RefObject<HTMLElement | null>;
  /** Fixed margins (CSS px) kept clear of the scene when no overlays are given. */
  readonly frame?: StageInsets;
  readonly onSelect: (target: StageTarget) => void;
  readonly children?: ReactNode;
  readonly live?: boolean;
}

function detectWebGL2(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

const NO_OVERLAYS: ReadonlyArray<RefObject<HTMLElement | null>> = [];
const CARD_FRAME: StageInsets = { top: 78, right: 20, bottom: 48, left: 20 };

function measureInsets(stage: HTMLElement, overlays: ReadonlyArray<RefObject<HTMLElement | null>>): StageInsets {
  const s = stage.getBoundingClientRect();
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const ref of overlays) {
    const el = ref.current;
    if (el === null) continue;
    const r = el.getBoundingClientRect();
    const overlaps = r.right > s.left && r.left < s.right && r.bottom > s.top && r.top < s.bottom;
    if (!overlaps || r.width === 0 || r.height === 0) continue;
    // Wide overlays bound the frame vertically, narrow ones horizontally; their centre picks the side.
    const wide = r.width > s.width * 0.6;
    const centred = Math.abs(r.left + r.width / 2 - (s.left + s.width / 2)) < s.width * 0.15;
    if (wide || centred) {
      if (r.top + r.height / 2 < s.top + s.height / 2) insets.top = Math.max(insets.top, r.bottom - s.top);
      else insets.bottom = Math.max(insets.bottom, s.bottom - r.top);
    } else if (r.left + r.width / 2 < s.left + s.width / 2) {
      insets.left = Math.max(insets.left, r.right - s.left);
    } else {
      insets.right = Math.max(insets.right, s.right - r.left);
    }
  }
  return insets;
}

type LabelSpec = {
  readonly id: AnchorId;
  readonly text: string;
  /** Shorter text for narrow stages; omitted labels are hidden there. */
  readonly short?: string;
  readonly tone: 'anon' | 'leak' | 'public' | 'steel' | 'neutral' | 'degraded';
  readonly target?: StageTarget;
  readonly minor?: boolean;
  readonly align?: 'center' | 'start' | 'end';
};

function labelsFor(scene: StageScene, live: boolean): LabelSpec[] {
  const offline = scene.workerState === 'BLOCKED' || scene.workerState === 'CLOSED';
  const labels: LabelSpec[] = [
    { id: 'client', text: 'Your browser', short: 'Your browser', tone: 'neutral', target: 'transport' },
    { id: 'endpoint', text: 'RPC endpoint', short: 'RPC endpoint', tone: 'neutral', target: 'endpoint' },
    {
      id: 'lane-direct',
      text: scene.privateMode ? 'Direct route' : 'Direct route · in use',
      tone: 'leak',
    },
  ];
  if (scene.passthrough) {
    labels.push({ id: 'worker', text: 'Passthrough · not anonymized', short: 'Passthrough', tone: 'neutral', target: 'transport' });
  } else {
    labels.push({
      id: 'lane-anon',
      text: offline ? 'Private route · offline' : live ? 'Private route · Nym worker' : 'Private route · three relays',
      tone: 'anon',
    });
  }
  if (scene.leakInjected) labels.push({ id: 'widget', text: 'Leaky checkout widget', short: 'Leaky widget', tone: 'leak' });
  if (scene.workerState === 'BOOTSTRAPPING') {
    labels.push({ id: 'bootstrap', text: 'Bootstrap lookup · not anonymous', short: 'Bootstrap · not anonymous', tone: 'leak', minor: true, align: 'start' });
  }
  return labels;
}

export function Stage({
  scene,
  flights,
  reducedMotion,
  overlays = NO_OVERLAYS,
  plaque,
  frame = CARD_FRAME,
  onSelect,
  children,
  live = false,
}: StageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<StageRenderer | null>(null);
  const labelRefs = useRef(new Map<AnchorId, HTMLElement>());
  const leaderRef = useRef<SVGPathElement>(null);
  const [supported] = useState(detectWebGL2);
  const [failed, setFailed] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const webgl = supported && !failed;

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!webgl || canvas === null || root === null) return;
    const renderer = StageRenderer.create(canvas);
    if (renderer === null) {
      const frame = requestAnimationFrame(() => setFailed(true));
      return () => cancelAnimationFrame(frame);
    }
    rendererRef.current = renderer;
    const handleContextLost = () => setFailed(true);
    canvas.addEventListener('webglcontextlost', handleContextLost);
    const labels = labelRefs.current;
    renderer.setAnchorListener((anchors: AnchorPositions) => {
      const stageWidth = root.clientWidth;
      for (const [id, el] of labels) {
        const a = anchors[id];
        if (a === undefined) continue;
        if (id === 'bootstrap' && stageWidth < 520) {
          // This is a disclosure, so reserve its own row above narrow scene geometry.
          el.style.transform = 'translate3d(20px, 70px, 0)';
          el.dataset['visible'] = 'true';
          continue;
        }
        const align = el.dataset['align'];
        const shift = align === 'end' ? '-100%' : align === 'start' ? '0%' : '-50%';
        const fraction = align === 'end' ? 1 : align === 'start' ? 0 : 0.5;
        const width = el.offsetWidth;
        const minimum = 8 + width * fraction;
        const maximum = stageWidth - 8 - width * (1 - fraction);
        const x = Math.max(minimum, Math.min(maximum, a.x));
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0) translate(${shift}, -50%)`;
        el.dataset['visible'] = a.visible ? 'true' : 'false';
      }
      const leader = leaderRef.current;
      const face = anchors['endpoint-face'];
      const target = plaque?.current ?? null;
      if (leader !== null && face !== undefined && target !== null) {
        const s = root.getBoundingClientRect();
        const r = target.getBoundingClientRect();
        const inside = r.left > s.left && r.left < s.right && r.top > s.top && r.top < s.bottom;
        if (!inside) {
          leader.setAttribute('d', '');
          return;
        }
        const x0 = r.left - s.left;
        const y0 = r.top - s.top + 28;
        const xm = x0 - 28;
        leader.setAttribute('d', `M ${x0} ${y0} H ${xm} L ${face.x.toFixed(1)} ${face.y.toFixed(1)}`);
      }
    });

    const updateInsets = () => renderer.setInsets(overlays.length > 0 ? measureInsets(root, overlays) : frame);
    const resize = new ResizeObserver(updateInsets);
    resize.observe(root);
    for (const ref of overlays) if (ref.current !== null) resize.observe(ref.current);
    updateInsets();

    let inView = true;
    const synchronizeVisibility = () => {
      if (inView && !document.hidden) renderer.start();
      else renderer.stop();
    };
    const visibility = new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting === true;
      synchronizeVisibility();
    });
    visibility.observe(root);
    document.addEventListener('visibilitychange', synchronizeVisibility);
    synchronizeVisibility();

    return () => {
      visibility.disconnect();
      document.removeEventListener('visibilitychange', synchronizeVisibility);
      resize.disconnect();
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [webgl, overlays, plaque, frame]);

  useEffect(() => {
    rendererRef.current?.setScene(scene);
  }, [scene, webgl]);

  useEffect(() => {
    rendererRef.current?.setFlights(flights);
  }, [flights, webgl]);

  useEffect(() => {
    rendererRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion, webgl]);

  useEffect(() => {
    rendererRef.current?.setMotionPaused(motionPaused);
  }, [motionPaused, webgl]);

  const labels = labelsFor(scene, live);

  return (
    <div ref={rootRef} className="stage" data-webgl={webgl ? 'on' : 'off'}
      data-motion={reducedMotion ? 'reduced' : motionPaused ? 'paused' : 'animated'}>
      {webgl ? (
        <>
          <canvas
            ref={canvasRef}
            className="stage__canvas"
            role="img"
            aria-label={live
              ? 'Illustrative network paths. Actual read outcomes and observer receipts are listed below; the drawing is not a measured hop count.'
              : 'Simulated routes from your browser to the RPC endpoint, through Anon-RPC or directly. Readable route cards and worker panels describe the same state.'}
          />
          <svg className="stage__leaders" aria-hidden="true">
            <path ref={leaderRef} d="" />
          </svg>
          <div className="stage__labels">
            {labels.map((label) => {
              const register = (el: HTMLElement | null) => {
                if (el === null) labelRefs.current.delete(label.id);
                else labelRefs.current.set(label.id, el);
              };
              const className = `stage-label stage-label--${label.tone}${label.minor ? ' stage-label--minor' : ''}${label.id === 'bootstrap' ? ' stage-label--bootstrap' : ''}${label.short === undefined ? ' stage-label--wide-only' : ''}`;
              const text = (
                <>
                  <span className="stage-label__long">{label.text}</span>
                  {label.short !== undefined && <span className="stage-label__short">{label.short}</span>}
                </>
              );
              if (label.target !== undefined) {
                const target = label.target;
                return (
                  <button
                    key={label.id}
                    ref={register}
                    type="button"
                    className={`${className} stage-label--action`}
                    data-align={label.align ?? 'center'}
                    onClick={() => onSelect(target)}
                  >
                    <span className="stage-label__dot" aria-hidden="true" />
                    {text}
                  </button>
                );
              }
              return (
                <span key={label.id} ref={register} className={className} data-align={label.align ?? 'center'} aria-hidden="true">
                  <span className="stage-label__dot" />
                  {text}
                </span>
              );
            })}
          </div>
          <div className="stage__tools" aria-label="3D view controls">
            {reducedMotion ? <span className="stage__motion-note" role="status" aria-label="Reduced motion is enabled"
              title="Your system preference reduces scene motion"><Icon name="info" size={16} /><span>Reduced motion</span></span>
              : <button type="button" className="stage__tool" aria-pressed={motionPaused}
                aria-label={motionPaused ? 'Resume scene motion' : 'Pause scene motion'}
                title={motionPaused ? 'Resume scene motion' : 'Pause decorative scene motion'}
                onClick={() => setMotionPaused((paused) => !paused)}>
                {motionPaused ? <Icon name="play" size={16} />
                  : <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M6.5 4v12M13.5 4v12" /></svg>}
                <span>{motionPaused ? 'Resume' : 'Pause'}</span>
              </button>}
            <button type="button" className="stage__tool stage__tool--reset" aria-label="Reset 3D view"
              title="Reset the 3D view" onClick={() => rendererRef.current?.resetView()}>
              <Icon name="reset" size={16} /><span>Reset view</span>
            </button>
          </div>
        </>
      ) : (
        <StageFallback scene={scene} flights={flights} onSelect={onSelect} live={live} />
      )}
      {children}
    </div>
  );
}
