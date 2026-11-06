import { bevelledBox, dustField, octahedron, ribbon, sphere, torus, type MeshData } from './geometry.js';
import {
  clamp01,
  easeInOutCubic,
  easeOutExpo,
  fractionNearest,
  lookAt,
  model,
  multiply,
  perspective,
  pointAt,
  project,
  type Curve,
  type Mat4,
  type Vec3,
} from './math.js';
import {
  ANCHORS,
  CAMERA_EYE,
  CAMERA_TARGET,
  CLIENT,
  LANE_CURVES,
  RELAYS,
  FIT_POINTS,
  SCENE_CENTER,
  SLAB_CENTER,
  SLAB_HALF,
  SLAB_YAW,
  WIDGET,
  BOOTSTRAP,
  slabFront,
  type AnchorId,
  type LaneKey,
} from './scene-layout.js';
import * as glsl from './shaders.js';

export type StageWorkerState = 'BOOTSTRAPPING' | 'READY' | 'DEGRADED' | 'BLOCKED' | 'CLOSED';

export interface StageScene {
  readonly workerState: StageWorkerState;
  readonly hopsReady: number;
  readonly passthrough: boolean;
  readonly privateMode: boolean;
  readonly leakInjected: boolean;
  readonly observerUp: boolean;
}

export interface StageFlight {
  readonly id: string;
  readonly lane: 'anon' | 'direct' | 'leak' | 'passthrough';
  /** Date.now() ms when the packet leaves. */
  readonly start: number;
  /** Null for a read blocked before send. */
  readonly durationMs: number | null;
}

export interface StageInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export type AnchorPositions = Partial<Record<AnchorId, { x: number; y: number; visible: boolean }>>;

const RGB = {
  anon: [0.74, 0.75, 1.0] as Vec3,
  anonDeep: [0.5, 0.41, 0.88] as Vec3,
  leak: [1.0, 0.48, 0.4] as Vec3,
  public: [0.95, 0.85, 0.58] as Vec3,
  steel: [0.72, 0.76, 0.86] as Vec3,
  degraded: [0.8, 0.66, 1.0] as Vec3,
  payload: [1.0, 0.95, 0.88] as Vec3,
  grey: [0.75, 0.75, 0.8] as Vec3,
  idleSeam: [0.64, 0.62, 0.94] as Vec3,
};

interface Program {
  readonly program: WebGLProgram;
  readonly uniforms: Map<string, WebGLUniformLocation>;
}

interface MeshBuffers {
  readonly vao: WebGLVertexArrayObject;
  readonly count: number;
}

interface RibbonBuffers {
  readonly vao: WebGLVertexArrayObject;
  readonly count: number;
}

interface ActiveFlight extends StageFlight {
  readonly blocked: boolean;
  arrived: boolean;
  /** Relays this packet has passed; each one peels a shell. */
  passed: number;
}

function compile(gl: WebGL2RenderingContext, vert: string, frag: string): Program {
  const program = gl.createProgram();
  const shaders = [
    [gl.VERTEX_SHADER, vert],
    [gl.FRAGMENT_SHADER, frag],
  ] as const;
  for (const [type, source] of shaders) {
    const shader = gl.createShader(type);
    if (shader === null) throw new Error('Shader allocation failed');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader) ?? 'unknown'}`);
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link failed: ${gl.getProgramInfoLog(program) ?? 'unknown'}`);
  }
  const uniforms = new Map<string, WebGLUniformLocation>();
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (info === null) continue;
    const name = info.name.replace(/\[0\]$/, '');
    const location = gl.getUniformLocation(program, info.name);
    if (location !== null) uniforms.set(name, location);
  }
  return { program, uniforms };
}

/**
 * Hand-written WebGL2 renderer for the route stage. React owns state; this class only draws it,
 * animates packets for in-flight reads, and reports where scene anchors land on screen.
 */
export class StageRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly programs: Record<'bg' | 'mesh' | 'floor' | 'ribbon' | 'point' | 'dust', Program>;
  private readonly meshes: Record<'slab' | 'orb' | 'ring' | 'relay' | 'widget', MeshBuffers>;
  private readonly lanes: Record<LaneKey, RibbonBuffers>;
  private readonly floor: WebGLVertexArrayObject;
  private readonly dust: { vao: WebGLVertexArrayObject; count: number };
  private readonly points: { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; capacity: number };
  private readonly empty: WebGLVertexArrayObject;
  private readonly relayT: number[];

  private scene: StageScene = {
    workerState: 'BOOTSTRAPPING',
    hopsReady: 0,
    passthrough: false,
    privateMode: true,
    leakInjected: false,
    observerUp: true,
  };
  private flights = new Map<string, ActiveFlight>();
  private insets: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private reducedMotion = false;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private viewProj: Mat4 = new Float32Array(16);
  private eye: Vec3 = CAMERA_EYE;
  private pxPerUnit = 1;
  private frame = 0;
  private running = false;
  private startedAt = performance.now();
  private pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  private slabFlash = { at: -1e9, color: RGB.anon as Vec3, dim: false };
  private relayFlash = [-1e9, -1e9, -1e9];
  private leakAlert = -1e9;
  private smooth = { hops: 0, leak: 0, private: 1, ring: 0 };
  private onAnchors: ((anchors: AnchorPositions) => void) | null = null;

  static create(canvas: HTMLCanvasElement): StageRenderer | null {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (gl === null) return null;
    try {
      return new StageRenderer(canvas, gl);
    } catch (error) {
      console.warn('Route stage unavailable; showing the schematic instead.', error);
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.programs = {
      bg: compile(gl, glsl.backgroundVert, glsl.backgroundFrag),
      mesh: compile(gl, glsl.meshVert, glsl.meshFrag),
      floor: compile(gl, glsl.floorVert, glsl.floorFrag),
      ribbon: compile(gl, glsl.ribbonVert, glsl.ribbonFrag),
      point: compile(gl, glsl.pointVert, glsl.pointFrag),
      dust: compile(gl, glsl.dustVert, glsl.dustFrag),
    };
    this.meshes = {
      slab: this.uploadMesh(bevelledBox(SLAB_HALF[0], SLAB_HALF[1], SLAB_HALF[2], 0.065)),
      orb: this.uploadMesh(sphere(0.38)),
      ring: this.uploadMesh(torus(0.62, 0.04)),
      relay: this.uploadMesh(octahedron(0.29)),
      widget: this.uploadMesh(bevelledBox(0.3, 0.19, 0.04, 0.025)),
    };
    const lanes = {} as Record<LaneKey, RibbonBuffers>;
    for (const key of Object.keys(LANE_CURVES) as LaneKey[]) lanes[key] = this.uploadRibbon(LANE_CURVES[key]);
    this.lanes = lanes;
    this.floor = this.uploadFloor();
    this.dust = this.uploadDust(96);
    this.points = this.createPointBuffer(256);
    this.empty = gl.createVertexArray();
    this.relayT = RELAYS.map((relay) => fractionNearest(LANE_CURVES.anon, relay));
    window.addEventListener('pointermove', this.handlePointer, { passive: true });
  }

  setAnchorListener(listener: ((anchors: AnchorPositions) => void) | null) {
    this.onAnchors = listener;
  }

  setScene(scene: StageScene) {
    if (scene.leakInjected && !this.scene.leakInjected) this.leakAlert = this.now();
    this.scene = scene;
    this.requestFrame();
  }

  setFlights(flights: readonly StageFlight[]) {
    const now = Date.now();
    for (const flight of flights) {
      if (this.flights.has(flight.id)) continue;
      // Ignore history that already finished before the stage saw it.
      const end = flight.start + (flight.durationMs ?? 900);
      if (end < now - 200) continue;
      this.flights.set(flight.id, { ...flight, blocked: flight.durationMs === null, arrived: false, passed: 0 });
    }
    const live = new Set(flights.map((flight) => flight.id));
    for (const id of this.flights.keys()) if (!live.has(id)) this.flights.delete(id);
    this.requestFrame();
  }

  setInsets(insets: StageInsets) {
    this.insets = insets;
    this.resize(true);
  }

  setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced;
    this.requestFrame();
  }

  resize(force = false) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (!force && w === this.width && h === this.height && dpr === this.dpr) return;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = w;
    this.canvas.height = h;
    this.requestFrame();
  }

  start() {
    this.running = true;
    this.requestFrame();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  dispose() {
    this.stop();
    window.removeEventListener('pointermove', this.handlePointer);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private handlePointer = (event: PointerEvent) => {
    this.pointer.tx = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointer.ty = (event.clientY / window.innerHeight) * 2 - 1;
  };

  private now() {
    return (performance.now() - this.startedAt) / 1000;
  }

  private requestFrame() {
    if (!this.running || this.frame !== 0) return;
    this.frame = requestAnimationFrame(this.render);
  }

  private needsContinuousFrames() {
    if (!this.reducedMotion) return true;
    if (this.flights.size > 0) return true;
    return this.now() - this.slabFlash.at < 2;
  }

  // ---------------------------------------------------------------- uploads

  private uploadMesh(mesh: MeshData): MeshBuffers {
    const { gl } = this;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const program = this.programs.mesh.program;
    const bind = (data: Float32Array, name: string) => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program, name);
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      }
    };
    bind(mesh.positions, 'aPos');
    bind(mesh.normals, 'aNormal');
    const index = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: mesh.indices.length };
  }

  private uploadRibbon(curve: Curve): RibbonBuffers {
    const { gl } = this;
    const data = ribbon(curve);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const program = this.programs.ribbon.program;
    const stride = 11 * 4;
    const attribs: Array<[string, number, number]> = [
      ['aPos', 3, 0],
      ['aPrev', 3, 12],
      ['aNext', 3, 24],
      ['aSide', 1, 36],
      ['aT', 1, 40],
    ];
    for (const [name, size, offset] of attribs) {
      const loc = gl.getAttribLocation(program, name);
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    }
    gl.bindVertexArray(null);
    return { vao, count: data.length / 11 };
  }

  private uploadFloor(): WebGLVertexArrayObject {
    const { gl } = this;
    const s = 30;
    const data = new Float32Array([-s, 0, -s, s, 0, -s, -s, 0, s, s, 0, s]);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.programs.floor.program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  private uploadDust(count: number) {
    const { gl } = this;
    const data = dustField(count);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const program = this.programs.dust.program;
    const attribs: Array<[string, number, number]> = [
      ['aPos', 3, 0],
      ['aSeed', 1, 12],
      ['aSize', 1, 16],
    ];
    for (const [name, size, offset] of attribs) {
      const loc = gl.getAttribLocation(program, name);
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 20, offset);
    }
    gl.bindVertexArray(null);
    return { vao, count };
  }

  private createPointBuffer(capacity: number) {
    const { gl } = this;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * 12 * 4, gl.DYNAMIC_DRAW);
    const program = this.programs.point.program;
    const attribs: Array<[string, number, number]> = [
      ['aPos', 3, 0],
      ['aSize', 1, 12],
      ['aColor', 4, 16],
      ['aHalo', 4, 32],
    ];
    for (const [name, size, offset] of attribs) {
      const loc = gl.getAttribLocation(program, name);
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 48, offset);
    }
    gl.bindVertexArray(null);
    return { vao, buffer, capacity };
  }

  // ---------------------------------------------------------------- camera

  private updateCamera(time: number) {
    const p = this.pointer;
    const follow = this.reducedMotion ? 0 : 0.045;
    p.x += (p.tx - p.x) * follow;
    p.y += (p.ty - p.y) * follow;
    const drift = this.reducedMotion ? 0 : Math.sin(time * 0.11) * 0.25;
    const eye: Vec3 = [CAMERA_EYE[0] + p.x * 0.7 + drift, CAMERA_EYE[1] - p.y * 0.35, CAMERA_EYE[2]];
    this.eye = eye;
    const view = lookAt(eye, CAMERA_TARGET, [0, 1, 0]);
    const aspect = this.width / this.height;

    // Fit the scene bounds into the frame left free by the HUD overlays.
    const cssW = this.width / this.dpr;
    const cssH = this.height / this.dpr;
    const left = -1 + (2 * this.insets.left) / cssW;
    const right = 1 - (2 * this.insets.right) / cssW;
    const bottom = -1 + (2 * this.insets.bottom) / cssH;
    const top = 1 - (2 * this.insets.top) / cssH;
    const frameW = Math.max(0.2, right - left);
    const frameH = Math.max(0.2, top - bottom);

    const baseTan = Math.tan((34 * Math.PI) / 360);
    const base = multiply(perspective((34 * Math.PI) / 180, aspect, 0.1, 80), view);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const corner of FIT_POINTS) {
      const c = project(base, corner);
      const x = c[0] / c[3];
      const y = c[1] / c[3];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    // Portrait frames leave less room for the HTML labels at the scene's edges.
    const marginX = aspect < 1 ? 0.82 : 0.97;
    const s = Math.max((maxX - minX) / (frameW * marginX), (maxY - minY) / (frameH * 0.95));
    const tanHalf = Math.min(Math.tan((80 * Math.PI) / 360), Math.max(Math.tan((14 * Math.PI) / 360), baseTan * s));
    const k = baseTan / tanHalf;
    const shiftX = (left + right) / 2 - ((minX + maxX) / 2) * k;
    const shiftY = (bottom + top) / 2 - ((minY + maxY) / 2) * k;
    const proj = perspective(2 * Math.atan(tanHalf), aspect, 0.1, 80);
    const shift = new Float32Array(16);
    shift[0] = 1;
    shift[5] = 1;
    shift[10] = 1;
    shift[15] = 1;
    shift[12] = shiftX;
    shift[13] = shiftY;
    this.viewProj = multiply(multiply(shift, proj), view);
    this.pxPerUnit = this.height / (2 * tanHalf);
  }

  // ---------------------------------------------------------------- frame

  private render = () => {
    this.frame = 0;
    const { gl } = this;
    const time = this.reducedMotion ? 4 : this.now();
    const clock = this.now();
    this.resize();
    this.updateCamera(time);

    const scene = this.scene;
    const ease = this.reducedMotion ? 1 : 0.08;
    const s = this.smooth;
    s.hops += (scene.hopsReady - s.hops) * ease;
    s.leak += ((scene.leakInjected ? 1 : 0) - s.leak) * ease;
    s.private += ((scene.privateMode ? 1 : 0) - s.private) * ease;
    const ringTarget = scene.workerState === 'BLOCKED' ? 0.62 : scene.workerState === 'CLOSED' ? 0 : 1;
    s.ring += (ringTarget - s.ring) * ease;

    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0.012, 0.009, 0.022, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const packets = this.advanceFlights(clock);
    this.drawBackground(clock);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);

    // Reflections, then the floor over them.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(true);
    this.drawObjects(time, clock, true);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    this.drawLanes(time, packets, true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.depthMask(false);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.drawFloor(clock);

    gl.depthMask(true);
    this.drawObjects(time, clock, false);
    gl.depthMask(false);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.drawLanes(time, packets, false);
    this.drawPackets(packets, clock);
    this.drawDust(time);
    gl.depthMask(true);

    this.emitAnchors();
    if (this.running && this.needsContinuousFrames()) this.requestFrame();
  };

  private advanceFlights(clock: number) {
    const now = Date.now();
    const active: Array<{ flight: ActiveFlight; progress: number }> = [];
    for (const flight of this.flights.values()) {
      if (now < flight.start) continue;
      if (flight.blocked) {
        const p = (now - flight.start) / 900;
        if (p <= 1) active.push({ flight, progress: p });
        continue;
      }
      const duration = flight.durationMs ?? 1;
      const p = (now - flight.start) / duration;
      if (p >= 1) {
        if (!flight.arrived) {
          flight.arrived = true;
          const color = flight.lane === 'anon' ? RGB.anon : flight.lane === 'passthrough' ? RGB.grey : RGB.leak;
          this.slabFlash = { at: clock, color, dim: !this.scene.observerUp };
        }
        continue;
      }
      active.push({ flight, progress: p });
      if (flight.lane === 'anon') {
        const t = easeInOutCubic(p);
        // Track passes explicitly so a slow frame cannot skip a relay's flash.
        while (flight.passed < this.relayT.length && t >= (this.relayT[flight.passed] ?? 2)) {
          this.relayFlash[flight.passed] = clock;
          flight.passed += 1;
        }
      }
      if (flight.lane === 'leak' && p < 0.05) this.leakAlert = clock;
    }
    return active;
  }

  private setMat(program: Program, name: string, value: Mat4) {
    const loc = program.uniforms.get(name);
    if (loc !== undefined) this.gl.uniformMatrix4fv(loc, false, value);
  }

  private set1(program: Program, name: string, value: number) {
    const loc = program.uniforms.get(name);
    if (loc !== undefined) this.gl.uniform1f(loc, value);
  }

  private set1i(program: Program, name: string, value: number) {
    const loc = program.uniforms.get(name);
    if (loc !== undefined) this.gl.uniform1i(loc, value);
  }

  private set2(program: Program, name: string, x: number, y: number) {
    const loc = program.uniforms.get(name);
    if (loc !== undefined) this.gl.uniform2f(loc, x, y);
  }

  private set3(program: Program, name: string, v: Vec3) {
    const loc = program.uniforms.get(name);
    if (loc !== undefined) this.gl.uniform3f(loc, v[0], v[1], v[2]);
  }

  private drawBackground(clock: number) {
    const { gl } = this;
    const p = this.programs.bg;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(p.program);
    gl.bindVertexArray(this.empty);
    const c = project(this.viewProj, SCENE_CENTER);
    this.set2(p, 'uRes', this.width, this.height);
    this.set2(p, 'uFocus', (c[0] / c[3]) * 0.5 + 0.5, (c[1] / c[3]) * 0.5 + 0.5);
    const tint: Vec3 = this.scene.workerState === 'BLOCKED' ? RGB.steel : RGB.anonDeep;
    this.set3(p, 'uTint', tint);
    const alert = Math.max(0, 1 - (clock - this.leakAlert) / 1.6) + this.smooth.leak * 0.25;
    this.set1(p, 'uAlert', alert);
    const slab = project(this.viewProj, SLAB_CENTER);
    this.set2(p, 'uSlab', (slab[0] / slab[3]) * 0.5 + 0.5, (slab[1] / slab[3]) * 0.5 + 0.5);
    const flash = Math.max(0, 1 - (clock - this.slabFlash.at) / 1.6);
    this.set3(p, 'uSlabColor', this.slabFlash.dim || flash === 0 ? RGB.anonDeep : this.slabFlash.color);
    this.set1(p, 'uSlabPower', 0.13 + (this.slabFlash.dim ? 0 : flash * 0.18));
    const horizon = project(this.viewProj, [0, 0, -28]);
    this.set1(p, 'uHorizon', (horizon[1] / horizon[3]) * 0.5 + 0.5);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private drawFloor(clock: number) {
    const { gl } = this;
    const p = this.programs.floor;
    gl.useProgram(p.program);
    this.setMat(p, 'uViewProj', this.viewProj);
    this.set3(p, 'uCenter', SCENE_CENTER);
    const flash = Math.max(0, 1 - (clock - this.slabFlash.at) / 1.4);
    const lightPos: number[] = [...CLIENT, ...SLAB_CENTER, ...WIDGET, ...WIDGET];
    const clientColor = this.scene.workerState === 'BLOCKED' ? RGB.steel : RGB.anon;
    const lightColor: number[] = [...clientColor, ...(this.slabFlash.dim ? RGB.grey : this.slabFlash.color), ...RGB.leak, ...RGB.public];
    const lightPower = [0.05, 0.015 + flash * 0.07, this.smooth.leak * 0.05, 0];
    const lp = p.uniforms.get('uLightPos');
    const lc = p.uniforms.get('uLightColor');
    const lw = p.uniforms.get('uLightPower');
    if (lp) gl.uniform3fv(lp, new Float32Array(lightPos));
    if (lc) gl.uniform3fv(lc, new Float32Array(lightColor));
    if (lw) gl.uniform1fv(lw, new Float32Array(lightPower));
    gl.bindVertexArray(this.floor);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawMesh(mesh: MeshBuffers, matrix: Mat4, opts: {
    material: 0 | 1 | 2;
    color: Vec3;
    glow?: Vec3;
    glowAmount?: number;
    opacity?: number;
    mirror: boolean;
    seam?: number;
    seamColor?: Vec3;
    scan?: number;
    band?: number;
    time: number;
  }) {
    const { gl } = this;
    const p = this.programs.mesh;
    this.setMat(p, 'uModel', matrix);
    this.set1i(p, 'uMaterial', opts.material);
    this.set3(p, 'uColor', opts.color);
    this.set3(p, 'uGlow', opts.glow ?? opts.color);
    this.set1(p, 'uGlowAmount', opts.glowAmount ?? 0);
    this.set1(p, 'uOpacity', opts.opacity ?? 1);
    this.set1(p, 'uMirror', opts.mirror ? 1 : 0);
    this.set1(p, 'uSeam', opts.seam ?? 0);
    this.set3(p, 'uSeamColor', opts.seamColor ?? RGB.idleSeam);
    this.set1(p, 'uScan', opts.scan ?? 0.5);
    this.set1(p, 'uBand', opts.band ?? -9);
    this.set3(p, 'uHalf', SLAB_HALF);
    this.set1(p, 'uTime', opts.time);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  }

  private drawObjects(time: number, clock: number, mirror: boolean) {
    const { gl } = this;
    const p = this.programs.mesh;
    gl.useProgram(p.program);
    this.setMat(p, 'uViewProj', this.viewProj);
    this.set3(p, 'uEye', this.eye);
    const scene = this.scene;
    const s = this.smooth;

    // Endpoint slab.
    const sinceFlash = clock - this.slabFlash.at;
    const flash = Math.max(0, 1 - sinceFlash / 1.5);
    const seamColor = this.slabFlash.dim ? [0.3, 0.3, 0.34] as Vec3 : flash > 0 ? this.slabFlash.color : RGB.idleSeam;
    const scan = this.reducedMotion ? 0.62 : clamp01(1 - easeOutExpo(Math.min(1, sinceFlash / 1.2)));
    // The specular band rests where the camera puts it and sweeps across the slab on arrival.
    const sweep = this.reducedMotion ? 1 : easeOutExpo(Math.min(1, sinceFlash / 1.1));
    const restBand = -0.1 + this.pointer.x * 0.35;
    const band = flash > 0 && !this.slabFlash.dim ? -1.3 + sweep * 2.6 : restBand;
    this.drawMesh(this.meshes.slab, model(SLAB_CENTER, SLAB_YAW), {
      material: 0,
      color: [0.47, 0.44, 0.65],
      mirror,
      seam: 0.1 + flash * (this.slabFlash.dim ? 0.15 : 0.9),
      seamColor,
      scan,
      band,
      time,
    });

    // Only the slab is tall enough to read as a reflection; the small bodies float too high to.
    if (mirror) return;

    // The browser and its worker ring.
    const blocked = scene.workerState === 'BLOCKED';
    const orbGlow: Vec3 = blocked ? RGB.steel : RGB.payload;
    const bob = this.reducedMotion ? 0 : Math.sin(time * 1.1) * 0.05;
    const clientPos: Vec3 = [CLIENT[0], CLIENT[1] + bob, CLIENT[2]];
    this.drawMesh(this.meshes.orb, model(clientPos), {
      material: 1,
      color: [0.62, 0.63, 0.8],
      glow: orbGlow,
      glowAmount: 0.28,
      mirror,
      time,
    });

    const ringColor: Vec3 = scene.passthrough
      ? RGB.grey
      : blocked
        ? RGB.steel
        : scene.workerState === 'DEGRADED'
          ? RGB.degraded
          : RGB.anon;
    const ringScale = 0.6 + 0.4 * s.ring;
    const ringMaterial = scene.workerState === 'BOOTSTRAPPING' ? 2 : 1;
    if (s.ring > 0.02) {
      const spin = this.reducedMotion ? 0.3 : time * 0.6;
      this.drawMesh(this.meshes.ring, model(clientPos, spin, [ringScale, ringScale, ringScale], 0.42), {
        material: ringMaterial,
        color: ringColor,
        glow: ringColor,
        glowAmount: 0.4 * (0.35 + 0.65 * s.private),
        opacity: 1,
        mirror,
        time,
      });
      if (blocked) {
        this.drawMesh(this.meshes.ring, model(clientPos, -spin * 0.5, [0.7, 0.7, 0.7], -0.9), {
          material: 1,
          color: RGB.steel,
          glow: RGB.steel,
          glowAmount: 0.7,
          mirror,
          time,
        });
      }
    }

    // Relays of the circuit.
    if (!scene.passthrough) {
      RELAYS.forEach((relay, i) => {
        const ready = clamp01(s.hops - i);
        const pulse = Math.max(0, 1 - (clock - (this.relayFlash[i] ?? -1e9)) / 0.7);
        const spin = this.reducedMotion ? 0.5 : time * (0.5 + i * 0.13);
        const color: Vec3 = blocked ? [0.3, 0.32, 0.4] : RGB.anon;
        this.drawMesh(this.meshes.relay, model(relay, spin), {
          material: 1,
          color: [0.42, 0.41, 0.57],
          glow: color,
          glowAmount: 0.08 + ready * 0.55 * (0.4 + 0.6 * s.private) + pulse * 1.2,
          mirror,
          time,
        });
      });
    }

    // Checkout status widget that bypasses the transport when the leak is injected.
    if (s.leak > 0.02) {
      this.drawMesh(this.meshes.widget, model(WIDGET, 0.25), {
        material: 1,
        color: [0.35, 0.1, 0.08],
        glow: RGB.leak,
        glowAmount: 1.1 * s.leak,
        opacity: s.leak,
        mirror,
        time,
      });
    }

    // Bootstrap specifier lookup (non-anonymous) while the worker starts.
    if (scene.workerState === 'BOOTSTRAPPING') {
      this.drawMesh(this.meshes.relay, model(BOOTSTRAP, time * 0.4, [0.7, 0.7, 0.7]), {
        material: 1,
        color: [0.2, 0.08, 0.07],
        glow: RGB.leak,
        glowAmount: 0.5,
        mirror,
        time,
      });
    }
  }

  private laneUniforms(key: LaneKey): { color: Vec3; intensity: number; dashed: boolean; width: number; flow: number } | null {
    const scene = this.scene;
    const s = this.smooth;
    const state = scene.workerState;
    switch (key) {
      case 'anon': {
        if (scene.passthrough) return null;
        const base =
          state === 'READY' ? 0.9 : state === 'DEGRADED' ? 0.62 : state === 'BOOTSTRAPPING' ? 0.2 + (s.hops / 3) * 0.32 : 0.16;
        return {
          color: state === 'DEGRADED' ? RGB.degraded : RGB.anon,
          intensity: base * (0.35 + 0.65 * s.private),
          dashed: state === 'BLOCKED' || state === 'CLOSED' || state === 'BOOTSTRAPPING',
          width: 17,
          flow: 1.2,
        };
      }
      case 'passthrough':
        return scene.passthrough
          ? { color: RGB.grey, intensity: 0.5, dashed: false, width: 11, flow: 1.6 }
          : null;
      case 'direct':
        return {
          color: RGB.leak,
          intensity: 0.36 + (1 - s.private) * 0.4,
          dashed: s.private > 0.5,
          width: 11,
          flow: 2.2,
        };
      case 'leak':
        return s.leak > 0.02 ? { color: RGB.leak, intensity: 0.7 * s.leak, dashed: false, width: 11, flow: 3 } : null;
      case 'settlement':
        return null;
      case 'bootstrap':
        return state === 'BOOTSTRAPPING'
          ? { color: RGB.leak, intensity: 0.55, dashed: true, width: 6, flow: 1 }
          : null;
    }
  }

  private drawLanes(time: number, packets: Array<{ flight: ActiveFlight; progress: number }>, mirror: boolean) {
    const { gl } = this;
    const p = this.programs.ribbon;
    gl.useProgram(p.program);
    this.setMat(p, 'uViewProj', this.viewProj);
    this.set2(p, 'uRes', this.width, this.height);
    this.set1(p, 'uTime', time);
    this.set1(p, 'uMirror', mirror ? 1 : 0);
    for (const key of Object.keys(this.lanes) as LaneKey[]) {
      const u = this.laneUniforms(key);
      if (u === null) continue;
      const travelling = packets.find((packet) => packet.flight.lane === key && !packet.flight.blocked);
      let pulse = 0;
      let pulseT = -1;
      let intensity = u.intensity;
      if (travelling) {
        const t = easeInOutCubic(travelling.progress);
        if (this.reducedMotion) {
          intensity += 0.6 * (1 - travelling.progress * 0.5);
        } else {
          pulse = 1;
          pulseT = t;
          intensity += 0.18;
        }
      }
      this.set3(p, 'uColor', u.color);
      this.set1(p, 'uIntensity', intensity);
      this.set1(p, 'uFlow', u.flow);
      this.set1(p, 'uDashed', u.dashed ? 1 : 0);
      this.set1(p, 'uPulse', pulse);
      this.set1(p, 'uPulseT', pulseT);
      this.set1(p, 'uReveal', 1.05);
      this.set1(p, 'uWidth', u.width * this.dpr);
      gl.bindVertexArray(this.lanes[key].vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.lanes[key].count);
    }
  }

  private drawPackets(packets: Array<{ flight: ActiveFlight; progress: number }>, clock: number) {
    const { gl } = this;
    const data: number[] = [];
    const heads: number[] = [];
    const push = (pos: Vec3, size: number, color: Vec3, alpha: number, halo: Vec3, shells: number) => {
      data.push(pos[0], pos[1], pos[2], size, color[0], color[1], color[2], alpha, halo[0], halo[1], halo[2], shells);
    };
    const pushHead = (pos: Vec3, size: number, shells: number) => {
      heads.push(pos[0], pos[1], pos[2], size, ...RGB.payload, 1, ...RGB.anon, 10 + shells);
    };
    const bloom = (pos: Vec3, size: number, color: Vec3, alpha: number) => {
      if (alpha > 0.005) push(pos, size, color, alpha, color, -2);
    };

    // Soft bloom around emitters; WebGL has no post-processing here, so sprites stand in for it.
    const scene = this.scene;
    const s = this.smooth;
    const blocked = scene.workerState === 'BLOCKED';
    bloom(CLIENT, 2.2, blocked ? RGB.steel : RGB.anon, 0.15);
    bloom(CLIENT, 0.9, RGB.payload, 0.16);
    if (!scene.passthrough) {
      RELAYS.forEach((relay, i) => {
        const ready = clamp01(s.hops - i) * (blocked ? 0.2 : 1);
        const pulse = Math.max(0, 1 - (clock - (this.relayFlash[i] ?? -1e9)) / 0.7);
        bloom(relay, 1.0 + pulse * 0.5, RGB.anon, 0.2 * ready + pulse * 0.3);
      });
    }
    const flash = Math.max(0, 1 - (clock - this.slabFlash.at) / 1.5);
    if (!this.slabFlash.dim) bloom(slabFront(-0.2, 0), 5.5, this.slabFlash.color, flash * 0.32);
    bloom(WIDGET, 1.6, RGB.leak, 0.4 * s.leak);
    // A ring bursts outward at each relay as a shell is peeled off the packet.
    if (!this.reducedMotion) {
      RELAYS.forEach((relay, i) => {
        const age = clock - (this.relayFlash[i] ?? -1e9);
        if (age >= 0 && age < 0.8) push(relay, 0.7 + age * 2.8, RGB.anon, (1 - age / 0.8) * 0.9, RGB.anon, -1);
      });
    }

    for (const { flight, progress } of packets) {
      if (flight.blocked) {
        // The read is refused at the worker ring: a short burst that never leaves the browser.
        const lane = LANE_CURVES[flight.lane === 'direct' ? 'direct' : 'anon'];
        const p = easeOutExpo(Math.min(1, progress * 1.6));
        const pos = pointAt(lane, 0.035 * p);
        const fade = 1 - clamp01((progress - 0.45) / 0.55);
        push(pos, 0.34, RGB.payload, fade, RGB.steel, -1);
        push(pos, 0.9 * p, RGB.steel, fade * 0.35, RGB.steel, 0);
        continue;
      }
      if (this.reducedMotion) {
        const end = pointAt(LANE_CURVES[flight.lane], 1);
        push(end, 0.32, RGB.payload, 1 - progress, RGB.leak, -1);
        continue;
      }
      const curve = LANE_CURVES[flight.lane];
      const t = easeInOutCubic(progress);
      const head = pointAt(curve, t);
      const laneColor = flight.lane === 'anon' ? RGB.anon : flight.lane === 'passthrough' ? RGB.grey : RGB.leak;
      for (let k = 14; k >= 1; k--) {
        const tt = t - k * 0.012;
        if (tt <= 0) continue;
        const fall = 1 - k / 15;
        push(pointAt(curve, tt), 0.16 * fall + 0.03, laneColor, 0.55 * fall, laneColor, 0);
      }
      let shells: number;
      let halo: Vec3 = RGB.leak;
      if (flight.lane === 'anon') {
        shells = this.relayT.reduce((left, rt) => (t >= rt ? left - 1 : left), 3);
        // After the exit relay the packet carries the exit's origin, never yours.
        halo = RGB.anon;
        if (shells === 0) shells = -1;
      } else if (flight.lane === 'passthrough') {
        shells = -1;
        halo = RGB.grey;
      } else {
        shells = -1;
      }
      if (flight.lane === 'anon' && shells > 0) pushHead(head, 0.95, shells);
      else push(head, 0.5, RGB.payload, 1, halo, shells);
    }
    const additive = Math.min(this.points.capacity, data.length / 12);
    const solid = Math.min(this.points.capacity - additive, heads.length / 12);
    if (additive + solid === 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.points.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([...data.slice(0, additive * 12), ...heads.slice(0, solid * 12)]));
    const p = this.programs.point;
    gl.useProgram(p.program);
    this.setMat(p, 'uViewProj', this.viewProj);
    this.set1(p, 'uPxPerUnit', this.pxPerUnit);
    this.set3(p, 'uShellColor', RGB.anon);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.points.vao);
    if (additive > 0) gl.drawArrays(gl.POINTS, 0, additive);
    if (solid > 0) {
      // Packet heads composite over the glow instead of adding to it.
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, additive, solid);
      gl.blendFunc(gl.ONE, gl.ONE);
    }
    gl.enable(gl.DEPTH_TEST);
  }

  private drawDust(time: number) {
    const { gl } = this;
    const p = this.programs.dust;
    gl.useProgram(p.program);
    this.setMat(p, 'uViewProj', this.viewProj);
    this.set1(p, 'uTime', time);
    this.set1(p, 'uPxPerUnit', this.pxPerUnit);
    gl.bindVertexArray(this.dust.vao);
    gl.drawArrays(gl.POINTS, 0, this.dust.count);
  }

  private emitAnchors() {
    if (this.onAnchors === null) return;
    const cssW = this.width / this.dpr;
    const cssH = this.height / this.dpr;
    const out: AnchorPositions = {};
    for (const id of Object.keys(ANCHORS) as AnchorId[]) {
      const c = project(this.viewProj, ANCHORS[id]);
      const x = ((c[0] / c[3]) * 0.5 + 0.5) * cssW;
      const y = (1 - ((c[1] / c[3]) * 0.5 + 0.5)) * cssH;
      out[id] = { x, y, visible: c[3] > 0 };
    }
    this.onAnchors(out);
  }
}
