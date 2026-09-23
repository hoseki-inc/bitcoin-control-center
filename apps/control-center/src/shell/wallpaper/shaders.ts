import type { WallpaperFamily } from './presets'

/** Full-screen triangle generated from gl_VertexID, so no vertex buffers are needed. */
export const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

const COMMON = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec4 u_seed;
uniform vec4 u_params;
uniform float u_grain;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec3 u_c4;

out vec4 outColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
    mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rotate = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = rotate * p * 2.02 + 17.0;
    amplitude *= 0.5;
  }
  return value;
}

// Film grain doubles as dithering, so slow gradients never band.
vec3 finish(vec3 color) {
  float g = hash12(gl_FragCoord.xy + fract(u_time * 7.0) * 311.0) - 0.5;
  return clamp(color + g * u_grain, 0.0, 1.0);
}
`

const AURORA = `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y) * u_params.x + u_seed.xy * 10.0;
  float t = u_time * 0.035;

  // Two rounds of domain warping give the slow, folded light of an aurora.
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + 0.6 * t), fbm(p + 3.0 * q + vec2(8.3, 2.8) - 0.4 * t));
  float f = fbm(p + 2.5 * r);

  vec3 color = mix(u_c0, u_c1, smoothstep(0.1, 0.9, f));
  color = mix(color, u_c2, smoothstep(0.35, 0.95, length(q)) * 0.9);
  color = mix(color, u_c3, smoothstep(0.55, 1.0, r.x) * 0.7);

  float vignette = smoothstep(1.3, 0.2, length((uv - 0.5) * vec2(aspect, 1.0)));
  color = mix(u_c0, color, 0.55 + 0.45 * vignette);
  vec2 glowAt = vec2(0.78 * aspect, 0.86);
  color += u_c4 * pow(max(0.0, 1.0 - length(vec2(uv.x * aspect, uv.y) - glowAt) * 0.9), 3.0) * 0.3;

  outColor = vec4(finish(color), 1.0);
}
`

const LANDSCAPE = `${COMMON}
float ridge(float x, float seed, float frequency, float amplitude) {
  float smooth_ = noise(vec2(x * frequency + seed, seed));
  float rough = fbm(vec2(x * frequency + seed, seed * 3.1));
  return mix(smooth_, rough, u_params.x) * amplitude;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  float x = uv.x * aspect;
  float drift = u_time * 0.004;

  vec3 color = mix(u_c1, u_c0, smoothstep(0.25, 1.0, uv.y));
  vec2 sun = vec2(u_params.z * aspect, u_params.y);
  float d = length(vec2(x, uv.y) - sun);
  color += u_c4 * (exp(-d * 10.0) * 0.8 + exp(-d * 2.4) * 0.22);

  // Ridges from far to near; far layers dissolve into the horizon haze.
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float depth = fi / 4.0;
    float base = 0.5 - depth * 0.105;
    float h = base + ridge(x + drift * (0.4 + depth), u_seed.x * 7.0 + fi * 13.7, 1.1 + depth * 1.5, 0.15 + depth * 0.05) - 0.07;
    float below = smoothstep(h + 0.002, h - 0.002, uv.y);
    vec3 layer = mix(u_c2, u_c3, depth);
    layer = mix(layer, u_c1, (1.0 - depth) * 0.6);
    layer += u_c4 * 0.1 * smoothstep(0.025, 0.0, h - uv.y) * (1.0 - depth);
    color = mix(color, layer, below);

    float mist = fbm(vec2(x * 1.8 - u_time * 0.012 * (1.0 + fi), uv.y * 5.0 + fi * 3.0));
    color = mix(color, u_c1, smoothstep(0.06, 0.0, abs(uv.y - h + 0.025)) * mist * 0.4 * (1.0 - depth * 0.5));
  }

  outColor = vec4(finish(color), 1.0);
}
`

const BLOCK = `${COMMON}
// Seeded by the latest block hash: the terrain changes a little with every block.
float field(vec2 p) {
  float t = u_time * 0.01;
  return fbm(p * 1.1 + u_seed.xy * 40.0 + vec2(t, -t * 0.6)) + 0.35 * fbm(p * 2.3 + u_seed.zw * 40.0 - t);
}

vec3 contours(vec2 uv, float aspect) {
  vec2 p = vec2(uv.x * aspect, uv.y);
  float f = field(p);
  vec3 color = mix(u_c0, u_c1, smoothstep(0.2, 0.9, f));
  color = mix(color, u_c2, smoothstep(0.55, 1.1, f) * 0.6);

  // Anti-aliased isolines; every fifth one is an index line in the accent colour.
  float scaled = f * u_params.y;
  float toLine = abs(fract(scaled - 0.5) - 0.5);
  float line = 1.0 - smoothstep(0.0, fwidth(scaled) * 1.5, toLine);
  float index = mod(floor(scaled + 0.5), 5.0) < 0.5 ? 1.0 : 0.0;
  color = mix(color, u_c3, line * (1.0 - index) * 0.55);
  color = mix(color, u_c4, line * index * 0.5);
  return color;
}

vec3 cells(vec2 uv, float aspect) {
  vec2 p = vec2(uv.x * aspect, uv.y) * u_params.y;
  vec2 cell = floor(p);
  vec2 local = fract(p);
  float nearest = 8.0;
  float second = 8.0;
  vec2 nearestId = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 id = cell + offset;
      vec2 jitter = hash22(id + u_seed.xy * 97.0);
      jitter = 0.5 + 0.35 * sin(u_time * 0.08 + 6.2831 * jitter);
      float dist = length(offset + jitter - local);
      if (dist < nearest) {
        second = nearest;
        nearest = dist;
        nearestId = id;
      } else if (dist < second) {
        second = dist;
      }
    }
  }
  float tone = hash12(nearestId + u_seed.zw * 53.0);
  vec3 color = mix(u_c0, u_c1, 0.4 + 0.6 * tone);
  color = mix(color, u_c2, smoothstep(0.2, 0.9, 1.0 - nearest) * 0.5);
  float edge = 1.0 - smoothstep(0.0, 0.022, second - nearest);
  color = mix(color, u_c3, edge * 0.18);
  // One warm cell, the newest block, breathes slowly.
  float chosen = step(0.985, tone);
  color += u_c4 * chosen * (0.07 + 0.04 * sin(u_time * 0.6)) * smoothstep(0.7, 0.0, nearest);
  float vignette = smoothstep(1.4, 0.3, length((uv - 0.5) * vec2(aspect, 1.0)));
  return mix(u_c0, color, 0.6 + 0.4 * vignette);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec3 color = u_params.x < 0.5 ? contours(uv, aspect) : cells(uv, aspect);
  outColor = vec4(finish(color), 1.0);
}
`

const GRAIN = `${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec3 color = mix(u_c0, u_c1, smoothstep(-0.2, 1.1, uv.y * 0.75 + uv.x * 0.25));
  color = mix(color, u_c2, 0.7 * smoothstep(1.1, 0.0, length((uv - vec2(0.15, 0.95)) * vec2(aspect, 1.0))));
  color = mix(color, u_c3, 0.6 * smoothstep(1.0, 0.0, length((uv - vec2(0.95, 0.05)) * vec2(aspect, 1.0))));
  color += (fbm(uv * 2.5 + u_time * 0.004) - 0.5) * 0.035;
  outColor = vec4(finish(color), 1.0);
}
`

export const FRAGMENT_SHADERS: Record<WallpaperFamily, string> = {
  aurora: AURORA,
  landscape: LANDSCAPE,
  block: BLOCK,
  grain: GRAIN,
}
