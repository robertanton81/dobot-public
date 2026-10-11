import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileWatermark } from './watermark'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dobot-watermark-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('fileWatermark', () => {
  it('reads null when the file is missing, and round-trips a written mark through the file', async () => {
    const path = join(dir, 'mail-watermark.json')
    const store = fileWatermark(path)
    expect(await store.read()).toBeNull()
    await store.write({ uidValidity: '1', uidNext: 12 })
    expect(await store.read()).toEqual({ uidValidity: '1', uidNext: 12 })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ uidValidity: '1', uidNext: 12 })
    await store.write({ uidValidity: null, uidNext: 13 })
    expect(await fileWatermark(path).read()).toEqual({ uidValidity: null, uidNext: 13 })
  })

  it('treats a corrupt or wrong-shaped file as no watermark', async () => {
    const path = join(dir, 'mail-watermark.json')
    await writeFile(path, '{ not json', 'utf8')
    expect(await fileWatermark(path).read()).toBeNull()
    await writeFile(path, JSON.stringify({ uidValidity: 1, uidNext: -3 }), 'utf8')
    expect(await fileWatermark(path).read()).toBeNull()
  })
})
