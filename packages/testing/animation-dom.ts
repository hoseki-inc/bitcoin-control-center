/** The SVG animation renderer uses a transparent canvas only as its unloaded-image placeholder. */
class AnimationPlaceholderContext {
  public fillStyle = ''

  public fillRect(x: number, y: number, width: number, height: number): void {
    if (x !== 0 || y !== 0 || width !== 1 || height !== 1 || this.fillStyle !== 'rgba(0,0,0,0)') {
      throw new Error('This DOM fixture supports only the transparent animation placeholder')
    }
  }
}

/** Supply the missing canvas placeholder in a test-owned DOM while running real SVG animations. */
export function installAnimationPlaceholder(canvas: typeof HTMLCanvasElement): void {
  Object.defineProperty(canvas.prototype, 'getContext', {
    configurable: true,
    value: (kind: string): AnimationPlaceholderContext | null =>
      kind === '2d' ? new AnimationPlaceholderContext() : null,
  })
}
