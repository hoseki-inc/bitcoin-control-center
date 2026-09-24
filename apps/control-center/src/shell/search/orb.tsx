import { Box, type BoxProps, usePrefersReducedMotion } from '@chakra-ui/react'
import { useEffect, useRef } from 'react'

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

/**
 * A lit sphere whose surface swirls: the noise domain turns while the light stays put,
 * so the orb reads as a solid object with weather moving across it.
 */
const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_energy;
uniform vec3 u_deep;
uniform vec3 u_primary;
uniform vec3 u_secondary;
uniform vec3 u_milk;
out vec4 outColor;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z
  );
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + 11.7;
    a *= 0.5;
  }
  return v;
}

mat2 rotate(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

void main() {
  vec2 p = (gl_FragCoord.xy / u_resolution) * 2.0 - 1.0;
  float r = length(p);
  float edge = fwidth(r) * 1.5;
  float alpha = 1.0 - smoothstep(1.0 - edge, 1.0, r);
  if (alpha <= 0.0) {
    outColor = vec4(0.0);
    return;
  }
  vec3 n = vec3(p, sqrt(max(0.0, 1.0 - r * r)));

  vec3 q = n;
  q.xz = rotate(u_time * 0.35) * q.xz;
  q.xy = rotate(u_time * 0.21) * q.xy;
  float swirl = fbm(q * 2.4 + vec3(0.0, u_time * 0.15, 0.0));
  float bands = fbm(q.yzx * 3.1 - vec3(u_time * 0.2));

  vec3 color = mix(u_deep, u_primary, smoothstep(0.25, 0.75, swirl));
  color = mix(color, u_secondary, smoothstep(0.5, 0.9, bands) * 0.75);

  vec3 light = normalize(vec3(-0.5, 0.66, 0.56));
  float diffuse = max(dot(n, light), 0.0);
  color *= 0.55 + 0.65 * diffuse;
  vec3 halfway = normalize(light + vec3(0.0, 0.0, 1.0));
  float nh = max(dot(n, halfway), 0.0);
  color += u_milk * (pow(nh, 5.0) * 0.18 + pow(nh, 40.0) * 0.3);
  color = mix(color, u_milk, pow(1.0 - n.z, 3.0) * 0.3);
  color *= 1.0 + u_energy * 0.25;

  float grain = fract(sin(dot(gl_FragCoord.xy + fract(u_time * 14.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  color += grain * 0.025;
  outColor = vec4(clamp(color, 0.0, 1.0) * alpha, alpha);
}
`

// Hoseki palette: amber depths, the brand yellow, a warm orange, and a milky highlight.
const PALETTE = {
  u_deep: [0.36, 0.2, 0.02],
  u_primary: [1.0, 0.85, 0.3],
  u_secondary: [1.0, 0.56, 0.12],
  u_milk: [1.0, 0.97, 0.86],
} as const

/** One clock for every orb, so a small orb and a large one show the same weather. */
const EPOCH = performance.now()

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (shader === null) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

const FALLBACK = 'radial-gradient(circle at 34% 30%, #FFF6D6 0%, #FFE56C 22%, #FFB02E 55%, #8A4B06 88%, #5C3204 100%)'

/**
 * The search orb. `energy` (0 to 1) speeds up and brightens the swirl, e.g. while typing.
 * Falls back to a static gradient without WebGL; stays still under reduced motion.
 */
export function Orb({
  size,
  energy = 0,
  live = true,
  ...rest
}: { size: number; energy?: number; live?: boolean } & Omit<BoxProps, 'children'>): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const energyRef = useRef(energy)
  energyRef.current = energy
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      powerPreference: 'low-power',
    })
    if (!gl) return
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX)
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT)
    if (vertex === null || fragment === null) return
    const program = gl.createProgram()
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) return
    gl.useProgram(program)
    canvas.dataset['ready'] = 'true'

    const dpr = Math.min(window.devicePixelRatio, 2)
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), canvas.width, canvas.height)
    for (const [name, [r, g, b]] of Object.entries(PALETTE)) gl.uniform3f(gl.getUniformLocation(program, name), r, g, b)
    const timeLocation = gl.getUniformLocation(program, 'u_time')
    const energyLocation = gl.getUniformLocation(program, 'u_energy')

    let phase = (performance.now() - EPOCH) / 1000
    let smoothed = 0
    let last = performance.now()
    let frame = 0
    const draw = (now: number): void => {
      const delta = Math.min(now - last, 100) / 1000
      last = now
      // Energy rises quickly and settles slowly.
      const target = energyRef.current
      smoothed += (target - smoothed) * Math.min(1, delta * (target > smoothed ? 9 : 1.4))
      phase += delta * (1 + 3.5 * smoothed)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform1f(timeLocation, phase)
      gl.uniform1f(energyLocation, smoothed)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    const loop = (now: number): void => {
      draw(now)
      frame = window.requestAnimationFrame(loop)
    }
    // Draw once straight away so the orb is never blank while waiting for the first frame.
    draw(performance.now())
    if (live && !reducedMotion) frame = window.requestAnimationFrame(loop)

    return () => {
      window.cancelAnimationFrame(frame)
      gl.deleteProgram(program)
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      delete canvas.dataset['ready']
    }
  }, [size, live, reducedMotion])

  return (
    <Box
      aria-hidden
      position="relative"
      boxSize={`${size}px`}
      borderRadius="full"
      flexShrink={0}
      bg={FALLBACK}
      boxShadow="inset 0 -2px 6px rgb(0 0 0 / 0.25)"
      {...rest}
    >
      <Box
        as="canvas"
        ref={canvasRef}
        position="absolute"
        inset={0}
        w="100%"
        h="100%"
        borderRadius="full"
        opacity={0}
        sx={{ '&[data-ready="true"]': { opacity: 1 } }}
      />
    </Box>
  )
}
