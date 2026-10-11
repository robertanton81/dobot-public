import { describe, expect, it } from 'vitest'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter'

describe('frontmatter', () => {
  it('round-trips fields and body', () => {
    const text = serializeFrontmatter({ name: 'search-board', description: 'Searches the board' }, 'Open the board.\nRead it.\n')
    expect(parseFrontmatter(text)).toEqual({
      fields: { name: 'search-board', description: 'Searches the board' },
      body: 'Open the board.\nRead it.\n',
    })
  })

  it('leaves a body that contains --- lines alone', () => {
    const body = 'first part\n---\nsecond part\n---\n'
    const parsed = parseFrontmatter(serializeFrontmatter({ name: 'x' }, body))
    expect(parsed.fields).toEqual({ name: 'x' })
    expect(parsed.body).toBe(body)
  })

  it('keeps everything after the first colon of a value', () => {
    const parsed = parseFrontmatter('---\ndescription: search: daily\n---\nbody')
    expect(parsed.fields.description).toBe('search: daily')
  })

  it('reads a CRLF-saved file the same as an LF one', () => {
    expect(parseFrontmatter('---\r\nname: x\r\nenabled: false\r\n---\r\nbody line\r\n')).toEqual({
      fields: { name: 'x', enabled: 'false' },
      body: 'body line\n',
    })
  })

  it('returns empty fields when there is no frontmatter', () => {
    expect(parseFrontmatter('just a body\n')).toEqual({ fields: {}, body: 'just a body\n' })
    expect(parseFrontmatter('---\nunterminated: yes\n')).toEqual({ fields: {}, body: '---\nunterminated: yes\n' })
  })

  it('flattens a line break inside a value so the block stays parseable', () => {
    const text = serializeFrontmatter({ description: 'two\nlines' }, '')
    expect(parseFrontmatter(text).fields.description).toBe('two lines')
  })

  it('skips a line whose key is not a plain identifier when parsing', () => {
    const parsed = parseFrontmatter('---\nname: ok\nbad key: dropped\nno colon here\n---\nbody')
    expect(parsed.fields).toEqual({ name: 'ok' })
    expect(parsed.body).toBe('body')
  })

  it('rejects a key that is not a plain identifier', () => {
    expect(() => serializeFrontmatter({ 'bad key': 'x' }, '')).toThrow('invalid frontmatter key')
  })
})
