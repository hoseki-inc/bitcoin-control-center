import { describe, expect, it } from 'vitest'
import keystone from './assets/lottie-animations/keystone/01.json'
import trezorPlugIn from './assets/lottie-animations/trezor-plug-in.json'
import trezorUniqueMessage from './assets/lottie-animations/trezor-unique-message.json'
import { hasRasterFrames, isWhiteBackdrop, withoutWhiteBackdrops } from './lottie-backdrop'

describe('withoutWhiteBackdrops', () => {
  it('drops full-frame white solids and keeps everything else', () => {
    const cleaned = withoutWhiteBackdrops(trezorPlugIn)
    expect(trezorPlugIn.layers.length - cleaned.layers.length).toBe(3)
    expect(cleaned.layers.some((layer) => layer.ty === 1 && layer.sc === '#ffffff')).toBe(false)
    expect(cleaned.layers.map((layer) => layer.nm)).toContain('trezor logo Outlines')
  })

  it('keeps white solids that draw part of the scene', () => {
    const cleaned = withoutWhiteBackdrops(trezorUniqueMessage)
    // "White Solid 7" is masked and parented: it is the device screen, not a backdrop.
    expect(cleaned.layers.map((layer) => layer.nm)).toContain('White Solid 7')
  })

  it('never modifies the original animation', () => {
    const before = trezorPlugIn.layers.length
    withoutWhiteBackdrops(trezorPlugIn)
    expect(trezorPlugIn.layers.length).toBe(before)
  })

  it('leaves coloured, masked and matte solids alone', () => {
    const base = { ty: 1, sc: '#ffffff', sw: 100, sh: 100 }
    expect(isWhiteBackdrop(base, 100, 100)).toBe(true)
    expect(isWhiteBackdrop({ ...base, sc: '#00e025' }, 100, 100)).toBe(false)
    expect(isWhiteBackdrop({ ...base, masksProperties: [{}] }, 100, 100)).toBe(false)
    expect(isWhiteBackdrop({ ...base, td: 1 }, 100, 100)).toBe(false)
    expect(isWhiteBackdrop({ ...base, sw: 50 }, 100, 100)).toBe(false)
  })

  it('recognises animations whose white is baked into raster frames', () => {
    expect(hasRasterFrames(keystone)).toBe(true)
    expect(hasRasterFrames(trezorPlugIn)).toBe(false)
  })
})
