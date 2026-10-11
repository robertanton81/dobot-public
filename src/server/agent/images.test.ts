import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { setPixel, solidPng } from './fakes'
import { cropAndScale, decode, meanAbsDiff, sample, sampleDiff } from './images'

describe('meanAbsDiff', () => {
  it('is below 1 for two 64x64 images that differ in one pixel', () => {
    const a = solidPng(64, 64, [0, 0, 0])
    const b = setPixel(a, 5, 5, [255, 255, 255])
    expect(meanAbsDiff(a, b)).toBeLessThan(1)
  })

  it('is 255 for an all-black and an all-white image', () => {
    expect(meanAbsDiff(solidPng(64, 64, [0, 0, 0]), solidPng(64, 64, [255, 255, 255]))).toBe(255)
  })

  it('grows with the changed area: a 24x24 white block on 64x64 black is far above the stuck threshold', () => {
    const image = PNG.sync.read(Buffer.from(solidPng(64, 64, [0, 0, 0])))
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) image.data.fill(255, (y * 64 + x) * 4, (y * 64 + x) * 4 + 3)
    const changed = new Uint8Array(PNG.sync.write(image))
    expect(meanAbsDiff(solidPng(64, 64, [0, 0, 0]), changed)).toBeGreaterThan(20)
  })

  it('is Infinity when the sizes differ', () => {
    expect(meanAbsDiff(solidPng(64, 64, [0, 0, 0]), solidPng(32, 64, [0, 0, 0]))).toBe(Infinity)
  })
})

describe('sample and sampleDiff', () => {
  it('keeps one luminance for every 8th pixel on both axes, with the size', () => {
    const s = sample(solidPng(64, 40, [255, 255, 255]))
    expect([s.width, s.height, s.luminance.length]).toEqual([64, 40, 8 * 5])
    expect(s.luminance[0]).toBeCloseTo(255, 3)
  })

  it('is 0 for the same image, the luminance gap for two solid images, and Infinity when the sizes differ', () => {
    const dark = sample(solidPng(64, 64, [50, 50, 50]))
    expect(sampleDiff(dark, sample(solidPng(64, 64, [50, 50, 50])))).toBe(0)
    expect(sampleDiff(dark, sample(solidPng(64, 64, [60, 60, 60])))).toBeCloseTo(10, 3)
    expect(sampleDiff(dark, sample(solidPng(32, 64, [50, 50, 50])))).toBe(Infinity)
  })
})

describe('cropAndScale', () => {
  it('scales a 20x10 region into 1280x800 as 1280x640', () => {
    const out = decode(cropAndScale(solidPng(100, 100, [10, 20, 30]), [0, 0, 20, 10], [1280, 800]))
    expect([out.width, out.height]).toEqual([1280, 640])
    expect([out.data[0], out.data[1], out.data[2]]).toEqual([10, 20, 30])
  })

  it('clamps a region that reaches outside the image and does not throw', () => {
    const out = decode(cropAndScale(solidPng(64, 64, [0, 0, 0]), [40, 40, 500, 500], [1280, 800]))
    expect(out.width).toBeLessThanOrEqual(1280)
    expect(out.height).toBeLessThanOrEqual(800)
    // The clamped crop is 24x24, so the output is square.
    expect(out.width).toBe(out.height)
  })

  it('keeps the pixels of the cropped area, not the rest of the image', () => {
    const source = setPixel(solidPng(8, 8, [0, 0, 0]), 6, 6, [200, 100, 50])
    const out = decode(cropAndScale(source, [6, 6, 8, 8], [4, 4]))
    expect([out.width, out.height]).toEqual([4, 4])
    expect([out.data[0], out.data[1], out.data[2]]).toEqual([200, 100, 50])
    expect([out.data[12], out.data[13], out.data[14]]).toEqual([0, 0, 0])
  })
})
