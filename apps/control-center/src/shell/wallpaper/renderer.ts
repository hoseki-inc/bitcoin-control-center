import type { WallpaperFamily, WallpaperMode, WallpaperPreset } from './presets'
import { FRAGMENT_SHADERS, VERTEX_SHADER } from './shaders'

type UniformName =
  'u_resolution' | 'u_time' | 'u_seed' | 'u_params' | 'u_grain' | 'u_c0' | 'u_c1' | 'u_c2' | 'u_c3' | 'u_c4'

interface ProgramInfo {
  program: WebGLProgram
  uniforms: Record<UniformName, WebGLUniformLocation | null>
}

export interface WallpaperFrame {
  preset: WallpaperPreset
  mode: WallpaperMode
  /** Seconds of animation time. */
  time: number
  /** Four values in [0, 1) that vary the pattern (the Bitcoin family uses the block hash). */
  seed: readonly [number, number, number, number]
  width: number
  height: number
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

/** Draws procedural wallpapers into one canvas; one WebGL2 context, one program per family. */
export class WallpaperRenderer {
  private readonly programs = new Map<WallpaperFamily, ProgramInfo>()

  private readonly canvas: HTMLCanvasElement
  private readonly gl: WebGL2RenderingContext

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas
    this.gl = gl
  }

  public static create(canvas: HTMLCanvasElement): WallpaperRenderer | null {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
      preserveDrawingBuffer: false,
    })
    return gl === null ? null : new WallpaperRenderer(canvas, gl)
  }

  public render({ preset, mode, time, seed, width, height }: WallpaperFrame): boolean {
    const { gl, canvas } = this
    if (gl.isContextLost()) {
      return false
    }
    const info = this.program(preset.family)
    if (info === null) {
      return false
    }

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    gl.viewport(0, 0, width, height)
    gl.useProgram(info.program)

    const { uniforms } = info
    const palette = preset.palettes[mode]
    gl.uniform2f(uniforms.u_resolution, width, height)
    gl.uniform1f(uniforms.u_time, time)
    gl.uniform4f(uniforms.u_seed, seed[0], seed[1], seed[2], seed[3])
    gl.uniform4f(uniforms.u_params, preset.params[0], preset.params[1], preset.params[2], preset.params[3])
    gl.uniform1f(
      uniforms.u_grain,
      (mode === 'dark' ? 0.045 : 0.03) * (preset.family === 'grain' ? preset.params[0] : 1),
    )
    const [c0, c1, c2, c3, c4] = palette
    const colors: ReadonlyArray<[UniformName, string]> = [
      ['u_c0', c0],
      ['u_c1', c1],
      ['u_c2', c2],
      ['u_c3', c3],
      ['u_c4', c4],
    ]
    for (const [name, hex] of colors) {
      const [r, g, b] = hexToRgb(hex)
      gl.uniform3f(uniforms[name], r, g, b)
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return true
  }

  public dispose(): void {
    for (const { program } of this.programs.values()) {
      this.gl.deleteProgram(program)
    }
    this.programs.clear()
  }

  private program(family: WallpaperFamily): ProgramInfo | null {
    const cached = this.programs.get(family)
    if (cached !== undefined) {
      return cached
    }
    const { gl } = this
    const vertex = this.compile(gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragment = this.compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADERS[family])
    if (vertex === null || fragment === null) {
      return null
    }
    const program = gl.createProgram()
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
      console.warn('[wallpaper] link failed', gl.getProgramInfoLog(program))
      gl.deleteProgram(program)
      return null
    }
    const locate = (name: UniformName): WebGLUniformLocation | null => gl.getUniformLocation(program, name)
    const uniforms: Record<UniformName, WebGLUniformLocation | null> = {
      u_resolution: locate('u_resolution'),
      u_time: locate('u_time'),
      u_seed: locate('u_seed'),
      u_params: locate('u_params'),
      u_grain: locate('u_grain'),
      u_c0: locate('u_c0'),
      u_c1: locate('u_c1'),
      u_c2: locate('u_c2'),
      u_c3: locate('u_c3'),
      u_c4: locate('u_c4'),
    }
    const info = { program, uniforms }
    this.programs.set(family, info)
    return info
  }

  private compile(type: number, source: string): WebGLShader | null {
    const { gl } = this
    const shader = gl.createShader(type)
    if (shader === null) {
      return null
    }
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
      console.warn('[wallpaper] compile failed', gl.getShaderInfoLog(shader))
      gl.deleteShader(shader)
      return null
    }
    return shader
  }
}
