// How long the log's cleaning takes on large hostile texts. Run from the repository root:
//   pnpm tsx docs/evidence/2026-09-20-audit-five-findings/clean-cost.mts
import { cleaned, hideInLogs } from '../../../src/server/log.ts'
hideInLogs(['marker-a1b2c3d4e5f6g7a1b2c3d4e5f6g7a1b2c3d4e5f6g7', 'second-registered-value-0123456789', 'third-registered-value-abcdefghij'])
const MB = 1_000_000
const shapes: [string, (n: number) => string][] = [
  ['plain x', (n) => 'x'.repeat(n)],
  ['://a: pairs', (n) => '://' + 'a:'.repeat(n / 2)],
  ['://a:b repeats', (n) => '://a:b'.repeat(n / 6)],
  ['Bearer + spaces', (n) => ('Bearer' + ' '.repeat(50)).repeat(n / 56)],
  ['password=', (n) => 'password='.repeat(n / 9)],
  ['token spaces colon', (n) => ('token' + ' '.repeat(40) + ':').repeat(n / 46)],
  ['?key=', (n) => '?key='.repeat(n / 5)],
  ['html-like page', (n) => '<div class="a" data-x=\'1\'>text & more; key: value, https://u:p@h/</div>\n'.repeat(n / 70)],
]
for (const size of [1 * MB, 5 * MB]) {
  for (const [name, make] of shapes) {
    const text = make(size)
    const started = performance.now()
    cleaned(text)
    console.log(`${(size / MB).toFixed(0)} MB  ${name.padEnd(20)} ${(performance.now() - started).toFixed(0)} ms`)
  }
}
