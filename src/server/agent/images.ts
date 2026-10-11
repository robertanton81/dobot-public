import { PNG } from 'pngjs'

// PNG helpers for the stuck detector (difference) and the zoom action (crop and scale).

export type Image = { width: number; height: number; data: Buffer }

const SAMPLE_STEP = 8

export function decode(png: Uint8Array): Image {
  const parsed = PNG.sync.read(Buffer.from(png))
  return { width: parsed.width, height: parsed.height, data: parsed.data }
}

export function encode(image: Image): Uint8Array {
  const png = new PNG({ width: image.width, height: image.height })
  image.data.copy(png.data)
  return new Uint8Array(PNG.sync.write(png))
}

function luminanceAt(data: Buffer, offset: number): number {
  return 0.299 * (data[offset] ?? 0) + 0.587 * (data[offset + 1] ?? 0) + 0.114 * (data[offset + 2] ?? 0)
}

/** The luminance of every 8th pixel on both axes: a screen's fingerprint, small enough to keep one per screenshot of a run. */
export type Sample = { width: number; height: number; luminance: Float32Array }

export function sample(png: Uint8Array): Sample {
  const image = decode(png)
  const columns = Math.ceil(image.width / SAMPLE_STEP)
  const rows = Math.ceil(image.height / SAMPLE_STEP)
  const luminance = new Float32Array(columns * rows)
  let i = 0
  for (let y = 0; y < image.height; y += SAMPLE_STEP) {
    for (let x = 0; x < image.width; x += SAMPLE_STEP) {
      luminance[i] = luminanceAt(image.data, (y * image.width + x) * 4)
      i += 1
    }
  }
  return { width: image.width, height: image.height, luminance }
}

/** Mean absolute luminance difference of two samples. Infinity when the sizes differ. */
export function sampleDiff(a: Sample, b: Sample): number {
  if (a.width !== b.width || a.height !== b.height) return Infinity
  let sum = 0
  for (let i = 0; i < a.luminance.length; i++) sum += Math.abs((a.luminance[i] ?? 0) - (b.luminance[i] ?? 0))
  return a.luminance.length === 0 ? 0 : sum / a.luminance.length
}

/** Mean absolute luminance difference, sampled every 8th pixel on both axes. Infinity when the sizes differ. */
export function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
  return sampleDiff(sample(a), sample(b))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Crops `region` ([x0, y0, x1, y1], clamped to the image) and scales it with nearest-neighbour
 * sampling to the largest size that fits `fit` while keeping the aspect ratio.
 */
export function cropAndScale(png: Uint8Array, region: [number, number, number, number], fit: [number, number]): Uint8Array {
  const image = decode(png)
  const x0 = clamp(Math.min(region[0], region[2]), 0, image.width - 1)
  const y0 = clamp(Math.min(region[1], region[3]), 0, image.height - 1)
  const x1 = clamp(Math.max(region[0], region[2]), x0 + 1, image.width)
  const y1 = clamp(Math.max(region[1], region[3]), y0 + 1, image.height)
  const cropWidth = x1 - x0
  const cropHeight = y1 - y0
  const scale = Math.min(fit[0] / cropWidth, fit[1] / cropHeight)
  const outWidth = Math.max(1, Math.round(cropWidth * scale))
  const outHeight = Math.max(1, Math.round(cropHeight * scale))
  const out = Buffer.alloc(outWidth * outHeight * 4)
  for (let oy = 0; oy < outHeight; oy++) {
    const sy = y0 + Math.min(cropHeight - 1, Math.floor(oy / scale))
    for (let ox = 0; ox < outWidth; ox++) {
      const sx = x0 + Math.min(cropWidth - 1, Math.floor(ox / scale))
      const src = (sy * image.width + sx) * 4
      const dst = (oy * outWidth + ox) * 4
      image.data.copy(out, dst, src, src + 4)
    }
  }
  return encode({ width: outWidth, height: outHeight, data: out })
}
