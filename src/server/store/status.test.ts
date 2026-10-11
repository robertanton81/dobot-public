import { describe, expect, it } from 'vitest'
import { clipStatus, STATUS_LINE_MAX } from './status'

describe('clipStatus', () => {
  it('keeps a short line as it is and cuts a long one to the limit with an ellipsis', () => {
    expect(clipStatus('working')).toBe('working')
    const long = 'x'.repeat(STATUS_LINE_MAX + 50)
    expect(clipStatus(long)).toHaveLength(STATUS_LINE_MAX)
    expect(clipStatus(long).endsWith('…')).toBe(true)
  })

  it('folds line breaks into spaces, because the line sits under the bot name', () => {
    expect(clipStatus('a\n  b')).toBe('a b')
  })
})
