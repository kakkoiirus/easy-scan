import { describe, expect, it } from 'vitest'
import {
  applyColorLuts,
  buildColorLuts,
  grayWorldGains,
  percentileValue,
} from './color-enhance'

/** Build an RGBA buffer from a list of RGB pixels (alpha forced to 255). */
const rgba = (...pixels: ReadonlyArray<readonly [number, number, number]>): Uint8Array => {
  const buf = new Uint8Array(pixels.length * 4)
  pixels.forEach((p, i) => {
    buf[i * 4] = p[0]
    buf[i * 4 + 1] = p[1]
    buf[i * 4 + 2] = p[2]
    buf[i * 4 + 3] = 255
  })
  return buf
}

describe('percentileValue', () => {
  it('returns the sole value when all mass sits on one bin', () => {
    const hist = new Uint32Array(256)
    hist[100] = 50
    expect(percentileValue(hist, 0.5)).toBe(100)
    expect(percentileValue(hist, 0.02)).toBe(100)
  })

  it('walks a uniform histogram to the right bin', () => {
    const hist = new Uint32Array(256)
    for (let i = 0; i < 256; i += 1) hist[i] = 1 // total 256
    expect(percentileValue(hist, 0.02)).toBe(5) // target 5.12 → first reach at v=5
    expect(percentileValue(hist, 0.98)).toBe(250) // target 250.88 → first reach at v=250
  })

  it('handles a bimodal histogram', () => {
    const hist = new Uint32Array(256)
    hist[0] = 50
    hist[255] = 50
    expect(percentileValue(hist, 0.5)).toBe(0) // target 50, reached at v=0
    expect(percentileValue(hist, 0.99)).toBe(255) // target 99, reached only at v=255
  })
})

describe('grayWorldGains', () => {
  it('is unity on a neutral (cast-free) image', () => {
    expect(grayWorldGains(rgba([128, 128, 128]), { min: 0.8, max: 1.25 })).toEqual([1, 1, 1])
  })

  it('clamps a strong warm cast to the gain bounds', () => {
    // meanR=200, meanG=128, meanB=80 → raw gains 0.64 / 1 / 1.6, both clamped.
    expect(grayWorldGains(rgba([200, 128, 80]), { min: 0.8, max: 1.25 })).toEqual([
      0.8, 1, 1.25,
    ])
  })

  it('leaves a mild cast unclamped', () => {
    // meanR=100, meanG=150, meanB=200 → gains 1.5 / 1 / 0.75, all in range.
    expect(grayWorldGains(rgba([100, 150, 200]), { min: 0.5, max: 2 })).toEqual([1.5, 1, 0.75])
  })
})

describe('buildColorLuts', () => {
  const neutral = [1, 1, 1] as const

  it('is the identity when the page already spans the range (no stretch)', () => {
    const luts = buildColorLuts(rgba([0, 0, 0], [255, 255, 255]), neutral, {
      minSpan: 200,
      pLo: 0.02,
      pHi: 0.98,
    })
    expect(luts.g[0]).toBe(0)
    expect(luts.g[128]).toBe(128)
    expect(luts.g[255]).toBe(255)
  })

  it('linearly maps a narrow [40,80] band across the full 0–255 range', () => {
    const luts = buildColorLuts(rgba([40, 40, 40], [80, 80, 80]), neutral, {
      minSpan: 200,
      pLo: 0.02,
      pHi: 0.98,
    })
    expect(luts.g[40]).toBe(0) // pLo → 0
    expect(luts.g[80]).toBe(255) // pHi → 255
    expect(luts.g[60]).toBe(127) // midpoint → ~127 (6.375·60 − 255 = 127.5 → 127)
  })

  it('composes the per-channel white-balance gain into the LUT', () => {
    // Wide span → identity stretch, so the LUT only reflects the WB gains.
    const luts = buildColorLuts(rgba([0, 0, 0], [255, 255, 255]), [1.5, 1, 0.75], {
      minSpan: 200,
      pLo: 0.02,
      pHi: 0.98,
    })
    expect(luts.r[100]).toBe(150) // 100 · 1.5
    expect(luts.r[200]).toBe(255) // clamped
    expect(luts.b[100]).toBe(75) // 100 · 0.75
    expect(luts.g[100]).toBe(100) // green is the reference
  })
})

describe('applyColorLuts', () => {
  it('maps each channel through its LUT and drops alpha', () => {
    const r = new Uint8Array(256).map((_, i) => i) // identity
    const g = new Uint8Array(256).fill(0)
    const b = new Uint8Array(256).fill(255)
    const rgb = applyColorLuts(rgba([10, 20, 30]), { r, g, b })
    expect(Array.from(rgb)).toEqual([10, 0, 255])
  })
})

describe('color enhance end-to-end (gains → luts → apply)', () => {
  it('leaves a well-lit neutral page unchanged (the faithful contract)', () => {
    const src = rgba([0, 0, 0], [85, 85, 85], [170, 170, 170], [255, 255, 255])
    const gains = grayWorldGains(src, { min: 0.8, max: 1.25 })
    const luts = buildColorLuts(src, gains, { minSpan: 200, pLo: 0.02, pHi: 0.98 })
    const rgb = applyColorLuts(src, luts)
    expect(Array.from(rgb)).toEqual([0, 0, 0, 85, 85, 85, 170, 170, 170, 255, 255, 255])
  })

  it('stretches a dark, flat page to use the full tonal range (the rescue)', () => {
    const src = rgba([40, 40, 40], [80, 80, 80])
    const gains = grayWorldGains(src, { min: 0.8, max: 1.25 })
    const luts = buildColorLuts(src, gains, { minSpan: 200, pLo: 0.02, pHi: 0.98 })
    const rgb = applyColorLuts(src, luts)
    // The narrow [40,80] input is mapped across [0,255] — midtones lift and the
    // page gains legibility without a density-based (mottle-causing) remap.
    expect(Math.min(...rgb)).toBe(0)
    expect(Math.max(...rgb)).toBe(255)
  })
})
