// Markdown with a leading `---` block of `key: value` lines. Values stay strings; the callers
// parse booleans. A body containing `---` lines is untouched because only the first block counts.

export type Frontmatter = { fields: Record<string, string>; body: string }

const KEY = /^[A-Za-z0-9_-]+$/

export function parseFrontmatter(input: string): Frontmatter {
  const text = input.replace(/\r\n/g, '\n') // a CRLF-saved file parses like any other
  if (!text.startsWith('---\n')) return { fields: {}, body: text }
  const end = text.indexOf('\n---\n', 4)
  if (end === -1) return { fields: {}, body: text }
  const fields: Record<string, string> = {}
  for (const line of text.slice(4, end).split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    if (!KEY.test(key)) continue
    fields[key] = line.slice(colon + 1).trim()
  }
  return { fields, body: text.slice(end + 5) }
}

export function serializeFrontmatter(fields: Record<string, string>, body: string): string {
  const lines = Object.entries(fields).map(([key, value]) => {
    if (!KEY.test(key)) throw new Error(`invalid frontmatter key "${key}"`)
    return `${key}: ${value.replace(/\s*\n\s*/g, ' ').trim()}`
  })
  return `---\n${lines.join('\n')}\n---\n${body}`
}
