/** GLSL ES 3.00 sources for the route stage. */

export const backgroundVert = /* glsl */ `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = P[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.9999, 1.0);
}`;

export const backgroundFrag = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uRes;
uniform vec2 uFocus;
uniform vec3 uTint;
uniform float uAlert;
uniform vec2 uSlab;
uniform vec3 uSlabColor;
uniform float uSlabPower;
uniform float uHorizon;
void main() {
  vec2 uv = vUv;
  vec3 col = mix(vec3(0.025, 0.031, 0.065), vec3(0.062, 0.058, 0.12), smoothstep(0.0, 1.0, uv.y));
  vec2 d = (uv - uFocus) * vec2(uRes.x / uRes.y, 1.0);
  float glow = exp(-dot(d * vec2(0.62, 1.9), d * vec2(0.62, 1.9)) * 2.6);
  col += uTint * 0.11 * glow;
  col += vec3(1.0, 0.33, 0.26) * 0.10 * uAlert * glow;
  vec2 b = (uv - uSlab) * vec2(uRes.x / uRes.y * 2.1, 0.95);
  col += uSlabColor * uSlabPower * exp(-dot(b, b) * 3.0);
  col += uTint * 0.035 * exp(-pow((uv.y - uHorizon) * 7.0, 2.0));
  float v = smoothstep(1.3, 0.25, length((uv - 0.5) * vec2(1.0, 1.25)));
  col *= mix(0.45, 1.0, v);
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) / 255.0 * 2.0;
  outColor = vec4(col, 1.0);
}`;

export const meshVert = /* glsl */ `#version 300 es
in vec3 aPos;
in vec3 aNormal;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform float uMirror;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vLocal;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vec3 n = mat3(uModel) * aNormal;
  if (uMirror > 0.5) { w.y = -w.y; n.y = -n.y; }
  vWorld = w.xyz;
  vNormal = n;
  vLocal = aPos;
  gl_Position = uViewProj * w;
}`;

export const meshFrag = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vLocal;
out vec4 outColor;
uniform vec3 uEye;
uniform int uMaterial;      // 0 satin endpoint slab, 1 emissive body, 2 dashed emissive ring
uniform vec3 uColor;
uniform vec3 uGlow;
uniform float uGlowAmount;
uniform vec3 uHalf;
uniform float uSeam;
uniform vec3 uSeamColor;
uniform float uScan;
uniform float uMirror;
uniform float uTime;
uniform float uOpacity;
uniform float uBand;

vec3 sky(vec3 r) {
  float h = r.y;
  vec3 c = mix(vec3(0.06, 0.064, 0.12), vec3(0.35, 0.31, 0.49), smoothstep(-0.25, 0.8, h));
  c += vec3(0.7, 0.6, 1.0) * 0.55 * exp(-pow((h - 0.04) * 7.0, 2.0));
  c += uSeamColor * uSeam * 0.45 * exp(-pow(h * 4.0, 2.0));
  float side = smoothstep(0.2, 1.0, r.x) * smoothstep(-0.1, 0.5, h);
  c += vec3(0.66, 0.62, 1.0) * 0.10 * side;
  return c;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uEye - vWorld);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  // Scene-owned soft key from upper left, plus a weaker right-side fill.
  // The same world-space directions illuminate every body; these are illustrative studio lights.
  vec3 L = normalize(vec3(-0.6, 0.8, 0.9));
  vec3 F = normalize(vec3(1.0, 0.25, 0.2));
  float key = max(dot(N, L), 0.0);
  float fill = max(dot(N, F), 0.0);
  vec3 H = normalize(L + V);
  vec3 col;
  if (uMaterial == 0) {
    vec3 R = reflect(-V, N);
    // Satin lavender metal: broad faces carry form and bevels catch the key light.
    col = uColor * (0.28 + 0.66 * key + 0.24 * fill) + sky(R) * (0.20 + 0.42 * fres);
    col += vec3(0.9, 0.91, 1.0) * pow(max(dot(N, H), 0.0), 48.0) * 0.48;
    vec3 q = abs(vLocal) / uHalf;
    float h = vLocal.y / uHalf.y;
    float sides = 1.0 - step(0.999, q.y);
    col += vec3(0.035, 0.03, 0.075) * (1.0 - h) * 0.5 * sides;
    col += vec3(0.5, 0.48, 0.9) * step(0.999, q.y) * step(0.0, vLocal.y) * 0.16;
    // A specular band across the faces: it follows the camera at rest and sweeps on arrival.
    float u = vLocal.x / uHalf.x * 0.55 + h * 0.4 + vLocal.z / uHalf.z * 0.12;
    float band = exp(-pow((u - uBand) * 4.5, 2.0));
    col += mix(vec3(0.62, 0.6, 1.0), uSeamColor, clamp(uSeam, 0.0, 1.0)) * band * sides * (0.07 + 0.4 * uSeam);
    vec3 e = smoothstep(0.986, 1.0, q);
    float edge = max(max(e.x * e.y, e.y * e.z), e.x * e.z);
    vec3 g = smoothstep(0.86, 1.0, q);
    float halo = max(max(g.x * g.y, g.y * g.z), g.x * g.z);
    col += uSeamColor * (edge * (0.16 + uSeam * 1.8) + halo * (0.04 + uSeam * 0.32));
    col += uSeamColor * fres * 0.22;
    float front = step(0.995, q.z) * step(0.0, vLocal.z);
    float scanBand = exp(-pow((vLocal.y / uHalf.y - (uScan * 2.0 - 1.0)) * 16.0, 2.0));
    float inner = front * (1.0 - smoothstep(0.80, 0.98, max(q.x, q.y)));
    col += uSeamColor * inner * scanBand * uSeam * 1.1;
    col += uSeamColor * inner * uSeam * 0.06;
  } else {
    float lambert = 0.28 + 0.7 * key + 0.22 * fill;
    float spec = pow(max(dot(N, H), 0.0), 40.0);
    col = uColor * lambert + sky(reflect(-V, N)) * fres * 0.22
      + uGlow * uGlowAmount * (0.32 + 0.3 * key + fres * 0.7) + spec * 0.3;
    if (uMaterial == 2) {
      float a = atan(vLocal.z, vLocal.x);
      float dash = smoothstep(0.35, 0.5, fract(a * 4.0 / 3.14159 + uTime * 0.35));
      col *= mix(0.12, 1.0, dash);
    }
  }
  float alpha = uOpacity;
  if (uMirror > 0.5) alpha *= 0.20 * exp(vWorld.y * 1.1);
  outColor = vec4(col * alpha, alpha);
}`;

export const floorVert = /* glsl */ `#version 300 es
in vec3 aPos;
uniform mat4 uViewProj;
out vec3 vWorld;
void main() {
  vWorld = aPos;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

export const floorFrag = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorld;
out vec4 outColor;
uniform vec3 uCenter;
uniform vec3 uLightPos[4];
uniform vec3 uLightColor[4];
uniform float uLightPower[4];
void main() {
  float r = length((vWorld.xz - uCenter.xz) * vec2(0.62, 1.0));
  vec3 col = vec3(0.035, 0.038, 0.075) * (1.0 - smoothstep(0.0, 13.0, r) * 0.7);
  for (int i = 0; i < 4; i++) {
    vec2 d = vWorld.xz - uLightPos[i].xz;
    col += uLightColor[i] * uLightPower[i] * exp(-dot(d, d) * 0.9);
  }
  float ring = abs(fract(r * 0.5) - 0.5);
  col += vec3(0.5, 0.56, 0.9) * 0.012 * smoothstep(0.03, 0.0, ring) * (1.0 - smoothstep(4.0, 11.0, r));
  float alpha = mix(0.84, 0.0, smoothstep(4.0, 19.0, r));
  outColor = vec4(col * alpha, alpha);
}`;

export const ribbonVert = /* glsl */ `#version 300 es
in vec3 aPos;
in vec3 aPrev;
in vec3 aNext;
in float aSide;
in float aT;
uniform mat4 uViewProj;
uniform vec2 uRes;
uniform float uWidth;
uniform float uMirror;
out float vSide;
out float vT;
vec4 toClip(vec3 p) {
  if (uMirror > 0.5) p.y = -p.y;
  return uViewProj * vec4(p, 1.0);
}
void main() {
  vec4 c = toClip(aPos);
  vec4 p = toClip(aPrev);
  vec4 n = toClip(aNext);
  float aspect = uRes.x / uRes.y;
  vec2 dir = n.xy / n.w - p.xy / p.w;
  dir.x *= aspect;
  dir = normalize(dir + vec2(1e-6, 0.0));
  vec2 normal = vec2(-dir.y, dir.x);
  normal.x /= aspect;
  c.xy += normal * aSide * (uWidth / uRes.y) * c.w;
  gl_Position = c;
  vSide = aSide;
  vT = aT;
}`;

export const ribbonFrag = /* glsl */ `#version 300 es
precision highp float;
in float vSide;
in float vT;
out vec4 outColor;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform float uFlow;
uniform float uDashed;
uniform float uMirror;
uniform float uPulseT;
uniform float uPulse;
uniform float uReveal;
void main() {
  float s = abs(vSide);
  float core = exp(-s * s * 10.0);
  float glow = exp(-s * s * 3.2) * 0.22;
  float flow = 0.7 + 0.3 * sin((vT * 22.0 - uTime * uFlow) * 1.5708);
  float dash = 1.0;
  if (uDashed > 0.5) dash = step(0.5, fract(vT * 46.0 - uTime * 0.25));
  float wave = uPulse * exp(-pow((vT - uPulseT) * 11.0, 2.0));
  float reveal = smoothstep(uReveal, uReveal - 0.02, vT);
  float i = (core + glow) * uIntensity * flow * dash * reveal + wave * (core * 2.6 + glow * 1.4);
  float ends = smoothstep(0.0, 0.035, vT) * smoothstep(1.0, 0.965, vT);
  vec3 col = uColor * i * ends;
  if (uMirror > 0.5) col *= 0.16;
  outColor = vec4(col, 1.0);
}`;

export const pointVert = /* glsl */ `#version 300 es
in vec3 aPos;
in float aSize;
in vec4 aColor;
in vec4 aHalo;
uniform mat4 uViewProj;
uniform float uPxPerUnit;
out vec4 vColor;
out vec4 vHalo;
void main() {
  vec4 c = uViewProj * vec4(aPos, 1.0);
  gl_Position = c;
  gl_PointSize = clamp(aSize * uPxPerUnit / c.w, 1.5, 180.0);
  vColor = aColor;
  vHalo = aHalo;
}`;

/** aHalo.rgb is the origin halo colour, aHalo.a the number of onion shells still wrapped. */
export const pointFrag = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
in vec4 vHalo;
out vec4 outColor;
uniform vec3 uShellColor;
void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float r = length(uv);
  if (r > 1.0) discard;
  float core = exp(-r * r * 16.0);
  float soft = exp(-r * r * 4.5) * 0.28;
  vec3 col = vColor.rgb * (core * 1.7 + soft);
  float shells = vHalo.a;
  if (shells > 9.5) {
    // Solid packet head: a dark backing disc keeps payload and shells legible over any glow.
    float n = shells - 10.0;
    float disc = smoothstep(1.0, 0.9, r);
    vec3 head = vec3(0.03, 0.02, 0.06);
    head += vColor.rgb * exp(-r * r * 26.0) * 1.8;
    for (int k = 0; k < 3; k++) {
      float on = clamp(n - float(k), 0.0, 1.0);
      float rr = 0.36 + float(k) * 0.2;
      head += uShellColor * on * exp(-pow((r - rr) * 20.0, 2.0)) * 1.25;
    }
    outColor = vec4(head * disc, disc * 0.9);
    return;
  }
  if (shells < -1.5) {
    // Soft bloom sprite.
    outColor = vec4(vColor.rgb * exp(-r * r * 3.4) * vColor.a, 1.0);
    return;
  }
  if (shells < 0.0) {
    col += vHalo.rgb * exp(-pow((r - 0.42) * 16.0, 2.0)) * 0.9;
  } else {
    for (int k = 0; k < 3; k++) {
      float on = clamp(shells - float(k), 0.0, 1.0);
      float rr = 0.40 + float(k) * 0.19;
      col += uShellColor * on * exp(-pow((r - rr) * 17.0, 2.0)) * 1.05;
    }
  }
  outColor = vec4(col * vColor.a, 1.0);
}`;

export const dustVert = /* glsl */ `#version 300 es
in vec3 aPos;
in float aSeed;
in float aSize;
uniform mat4 uViewProj;
uniform float uTime;
uniform float uPxPerUnit;
out float vAlpha;
out float vSeed;
void main() {
  vec3 p = aPos;
  float t = uTime * (0.25 + aSeed * 0.5);
  p += vec3(sin(t * 0.21 + aSeed * 40.0) * 0.35, sin(t * 0.17 + aSeed * 13.0) * 0.28, cos(t * 0.13 + aSeed * 7.0) * 0.3);
  vec4 c = uViewProj * vec4(p, 1.0);
  gl_Position = c;
  gl_PointSize = clamp(aSize * uPxPerUnit / c.w, 1.0, 96.0);
  float twinkle = 0.55 + 0.45 * sin(uTime * (0.6 + aSeed) + aSeed * 30.0);
  vAlpha = twinkle * (aSize > 0.1 ? 0.045 : 0.5);
  vSeed = aSeed;
}`;

export const dustFrag = /* glsl */ `#version 300 es
precision highp float;
in float vAlpha;
in float vSeed;
out vec4 outColor;
void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float r = length(uv);
  if (r > 1.0) discard;
  float disc = smoothstep(1.0, 0.55, r);
  vec3 tone = mix(vec3(0.66, 0.66, 1.0), vec3(0.88, 0.78, 1.0), vSeed);
  outColor = vec4(tone * disc * vAlpha, 1.0);
}`;
