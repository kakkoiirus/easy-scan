// Pure "soft global" tonal cleanup for the color enhance mode — the testable
// seam of the otherwise OpenCV-bound worker (a sibling to `detect-geometry.ts`
// and `flatten-geometry.ts`). Everything here is a pure function over plain
// pixel buffers (see CLAUDE.md: pure functions for logic); the worker wraps
// OpenCV only for the (optional) HSV saturation lift.
//
// The color mode keeps the page faithful to the photograph — only flattened —
// with a mild, *global* cleanup. An earlier pass histogram-equalized the
// luminance (equalizeHist on V): equalizeHist remaps by population density, so
// the near-uniform bright paper became a steep part of the CDF and microscopic
// paper variations were stretched into visible bands/mottle — the page read as
// dirty gray. These helpers do no density-based remap. They apply two single
// global curves (no spatial/adaptive remap, so no mottle):
//   1. Gray-world white balance — a per-channel gain so the channel means agree,
//      clamped so a colourful page isn't pushed off its rails. Removes the
//      phone's colour cast.
//   2. A *linear* luminance stretch (2nd→98th percentile → 0–255) shared across
//      all three channels (hue ratios survive). A linear map — unlike
//      equalizeHist's CDF — expands a narrow band uniformly, without magnifying
//      texture into mottle; and it fires only when the page is genuinely
//      low-range (dark/flat), leaving a well-lit page untouched.
// `convertScaleAbs` can't express the stretch (its negative offset would be
// folded by the Abs), so the whole WB+stretch runs as a precomputed per-channel
// lookup table instead.

/** White-balance gains (R, G, B) under the gray-world assumption: each channel
 *  scaled so its mean matches the green channel's, clamped to `range` so a page
 *  dominated by one colour isn't skewed. Green is the reference, so its gain is
 *  always 1. Pure. */
export function grayWorldGains(
  rgba: Uint8Array,
  range: { readonly min: number; readonly max: number },
): readonly [number, number, number] {
  let sumR = 0
  let sumG = 0
  let sumB = 0
  for (let i = 0; i < rgba.length; i += 4) {
    sumR += rgba[i]
    sumG += rgba[i + 1]
    sumB += rgba[i + 2]
  }
  const meanG = sumG / (rgba.length / 4)
  const clampGain = (meanChannel: number): number =>
    meanChannel > 0
      ? Math.min(range.max, Math.max(range.min, meanG / meanChannel))
      : 1
  return [clampGain(sumR / (rgba.length / 4)), 1, clampGain(sumB / (rgba.length / 4))]
}

/** The value at `fraction` of the cumulative `hist` (0–255) — a histogram
 *  percentile. Pure. */
export function percentileValue(hist: Uint32Array, fraction: number): number {
  let total = 0
  for (let i = 0; i < 256; i += 1) total += hist[i]
  const target = total * fraction
  let acc = 0
  for (let v = 0; v < 256; v += 1) {
    acc += hist[v]
    if (acc >= target) return v
  }
  return 255
}

/** One 256-entry lookup table per RGB channel, composing white balance (per-
 *  channel gain) with the shared linear luminance stretch — so the whole tonal
 *  cleanup applies in a single indexed pass. The stretch is derived from the
 *  post-white-balance luminance and is identity once the page already spans
 *  `minSpan`. Pure. */
export function buildColorLuts(
  rgba: Uint8Array,
  gains: readonly [number, number, number],
  opts: { readonly minSpan: number; readonly pLo: number; readonly pHi: number },
): { readonly r: Uint8Array; readonly g: Uint8Array; readonly b: Uint8Array } {
  // Luminance *after* white balance — the percentiles come from it and the
  // resulting stretch is shared across channels so hue ratios survive.
  const lum = new Uint32Array(256)
  for (let i = 0; i < rgba.length; i += 4) {
    const y =
      (0.299 * rgba[i] * gains[0] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2] * gains[2]) | 0
    lum[y < 0 ? 0 : y > 255 ? 255 : y] += 1
  }
  const pLo = percentileValue(lum, opts.pLo)
  const pHi = percentileValue(lum, opts.pHi)
  const span = pHi - pLo
  const stretchable = span > 0 && span < opts.minSpan
  const alpha = stretchable ? 255 / span : 1
  const beta = stretchable ? (-pLo * 255) / span : 0
  // Linear map with hard clamps (Uint8Array assignment would wrap negatives).
  const map = (x: number): number => {
    const v = alpha * x + beta
    return v < 0 ? 0 : v > 255 ? 255 : v | 0
  }
  const compose = (gain: number): Uint8Array => {
    const lut = new Uint8Array(256)
    for (let x = 0; x < 256; x += 1) lut[x] = map(x * gain)
    return lut
  }
  return { r: compose(gains[0]), g: compose(gains[1]), b: compose(gains[2]) }
}

/** Apply per-channel lookup tables to an RGBA buffer, dropping alpha → an
 *  interleaved RGB buffer (CV_8UC3 layout) ready for OpenCV. Pure. */
export function applyColorLuts(
  rgba: Uint8Array,
  luts: { readonly r: Uint8Array; readonly g: Uint8Array; readonly b: Uint8Array },
): Uint8Array {
  const rgb = new Uint8Array((rgba.length / 4) * 3)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = luts.r[rgba[i]]
    rgb[j + 1] = luts.g[rgba[i + 1]]
    rgb[j + 2] = luts.b[rgba[i + 2]]
  }
  return rgb
}
