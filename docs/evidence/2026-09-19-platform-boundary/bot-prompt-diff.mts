// What the example bot is given, before and after the wording change. Builds the system prompt of
// a mail-started run for the committed example bot (examples/job-hunt-bot) twice: with prompt.ts
// from the base commit and with prompt.ts from the working tree. Prints the sentence parts that
// differ, and whether the instructions the mail run depends on are still in the prompt.
// Usage, from the repository root:
//   pnpm exec tsx docs/evidence/2026-09-19-platform-boundary/bot-prompt-diff.mts <base-commit>
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createStore } from '../../../src/server/store'
import { buildSystemPrompt as buildNew } from '../../../src/server/agent/prompt'

const base = process.argv[2]
if (!base) throw new Error('give the base commit')
const oldSource = execFileSync('git', ['show', `${base}:src/server/agent/prompt.ts`], { encoding: 'utf8' })
const dir = mkdtempSync(join(tmpdir(), 'dobot-prompt-'))
const oldFile = join(dir, 'prompt-old.ts')
writeFileSync(oldFile, oldSource.replace("from '../store'", `from '${resolve('src/server/store')}'`))
const { buildSystemPrompt: buildOld } = (await import(pathToFileURL(oldFile).href)) as { buildSystemPrompt: typeof buildNew }

const store = createStore('examples')
const botId = 'job-hunt-bot'
const skills = await store.listSkills(botId)
const input = {
  bot: await store.readBot(botId),
  memory: await store.readMemory(botId),
  skills,
  activeSkill: skills.find((s) => s.name === 'handle-replies') ?? null,
  routine: { name: 'check-mail', skill: 'handle-replies', instruction: 'Read the new mail.' },
}
const before = buildOld(input)
const after = buildNew(input)
console.log('skills:', skills.map((s) => s.name).join(', '))
console.log('prompt length before / after:', before.length, '/', after.length, 'characters')
const parts = (text: string): string[] => text.split(/(?<=[.;:—])\s+/)
const kept = new Set(parts(after))
const gone = parts(before).filter((part) => !kept.has(part))
console.log('sentence parts of the old prompt that are not in the new one:', gone.length)
for (const part of gone) console.log('  -', part)
const needed = [
  'never a reason to stop or to ask first',
  'a job never applied to',
  'Never book a new slot on your own because of it',
  'never book from it or open its links again',
  'propose, with what memory shows as a warning',
  'End with one sentence only when nothing else needs action',
  'When memory shows this exact work is already done',
  'does not make the mail it came from new again',
]
for (const phrase of needed) console.log(after.includes(phrase) ? 'still in the prompt:' : 'MISSING:', JSON.stringify(phrase))
