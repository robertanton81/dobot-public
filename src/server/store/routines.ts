import { Cron } from 'croner'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { log } from '../log'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter'
import { assertSlug, botDir, isNotFound, routinesDir, withFileLock, writeFileAtomic } from './paths'
import { readSkill } from './skills'
import { Routine, RoutineReceipt, SLUG } from './types'

export async function listRoutines(dataDir: string, botId: string): Promise<Routine[]> {
  let entries: string[]
  try {
    entries = await readdir(routinesDir(dataDir, botId))
  } catch (e) {
    if (isNotFound(e)) return []
    throw e
  }
  const routines: Routine[] = []
  for (const file of entries.sort()) {
    if (!file.endsWith('.md')) continue
    // A file somebody put there under a name the platform would never give is not one of the bot's routines.
    if (!SLUG.test(file.slice(0, -3))) {
      log.warn('skipping a file whose name is not a valid name', { botId, folder: 'routines', file })
      continue
    }
    const routine = await readRoutine(dataDir, botId, file.slice(0, -3))
    if (routine) routines.push(routine)
  }
  return routines
}

/** Missing files return null; strict reads throw on malformed files so delivery stays pending. */
export async function readRoutine(dataDir: string, botId: string, name: string, strict = false): Promise<Routine | null> {
  assertSlug(name)
  let text: string
  try {
    text = await readFile(join(routinesDir(dataDir, botId), name + '.md'), 'utf8')
  } catch (e) {
    if (isNotFound(e)) return null
    throw e
  }
  const { fields, body } = parseFrontmatter(text)
  const invalid = (message: string): null => {
    log.warn(message, { botId, name })
    if (strict) throw new Error(message)
    return null
  }
  const enabled = fields.enabled === undefined ? true : fields.enabled === 'true' ? true : fields.enabled === 'false' ? false : null
  if (enabled === null) {
    return invalid('routine file has an invalid enabled value')
  }
  const parsed = Routine.safeParse({
    name: fields.name ?? name,
    skill: fields.skill ?? '',
    schedule: fields.schedule ?? null,
    event: fields.event ?? null,
    enabled,
    body,
  })
  if (!parsed.success) {
    return invalid('routine file does not parse')
  }
  if ((parsed.data.schedule === null) === (parsed.data.event === null)) {
    return invalid('routine file needs exactly one of schedule or event')
  }
  return parsed.data
}

export async function readRoutineReceipt(dataDir: string, botId: string, name: string): Promise<RoutineReceipt | null> {
  assertSlug(name)
  let text: string
  try {
    text = await readFile(join(botDir(dataDir, botId), `routine-event-${name}.json`), 'utf8')
  } catch (e) {
    if (isNotFound(e)) return null
    throw e
  }
  try {
    return RoutineReceipt.parse(JSON.parse(text))
  } catch {
    throw new Error('routine event receipt does not parse')
  }
}

/** Separate files keep concurrent routine acknowledgements away from status writes to bot.json. */
export async function writeRoutineReceipt(dataDir: string, botId: string, name: string, receipt: RoutineReceipt): Promise<void> {
  assertSlug(name)
  await writeFileAtomic(join(botDir(dataDir, botId), `routine-event-${name}.json`), JSON.stringify(RoutineReceipt.parse(receipt)) + '\n')
}

/** The closest two runs of one routine may be, unless the operator sets `ROUTINE_MIN_INTERVAL_MINUTES`. */
export const DEFAULT_ROUTINE_MIN_INTERVAL_MINUTES = 15

export type RoutineLimits = {
  /** A schedule whose two closest runs are nearer than this is refused when it is saved. */
  minIntervalMs: number
  /** The routines' clock (`TZ`), so gaps are measured the way the scheduler fires them. */
  timezone?: string
}

export const DEFAULT_ROUTINE_LIMITS: RoutineLimits = { minIntervalMs: DEFAULT_ROUTINE_MIN_INTERVAL_MINUTES * 60_000 }

/**
 * How many upcoming runs the density check compares. A cron repeats its shape every day, week or
 * year, so a close pair shows up within the first runs of that shape; the next two runs alone miss
 * `0,5 7 * * *` saved at 07:03.
 */
const DENSITY_RUNS = 100

/** The smallest gap between consecutive run times, or null when there are fewer than two. */
export function smallestGapMs(runs: Date[]): number | null {
  let smallest: number | null = null
  for (let i = 1; i < runs.length; i++) {
    const before = runs[i - 1]
    const after = runs[i]
    if (!before || !after) continue
    const gap = after.getTime() - before.getTime()
    if (smallest === null || gap < smallest) smallest = gap
  }
  return smallest
}

/**
 * Throws `invalid schedule: …` for a bad cron expression and `schedule runs too often: …` for one
 * denser than the limit; exactly one of schedule, event is required.
 */
export function validateRoutine(routine: Routine, limits: RoutineLimits = DEFAULT_ROUTINE_LIMITS): Routine {
  const parsed = Routine.safeParse(routine)
  if (!parsed.success) {
    throw new Error('invalid routine: ' + parsed.error.issues.map((i) => `${i.path.join('.') || 'routine'} ${i.message}`).join('; '))
  }
  const valid = parsed.data
  assertSlug(valid.name)
  if ((valid.schedule === null) === (valid.event === null)) {
    throw new Error('a routine needs exactly one of schedule or event')
  }
  if (valid.schedule !== null) {
    let job: Cron
    try {
      job = new Cron(valid.schedule, { paused: true, ...(limits.timezone === undefined ? {} : { timezone: limits.timezone }) })
    } catch (e) {
      throw new Error('invalid schedule: ' + (e instanceof Error ? e.message : String(e)))
    }
    const gap = smallestGapMs(job.nextRuns(DENSITY_RUNS))
    if (gap !== null && gap < limits.minIntervalMs) {
      // Written for the bot: save_routine hands this sentence to the model, which can pick a wider schedule.
      throw new Error(`schedule runs too often: the closest a routine may run is every ${Math.round(limits.minIntervalMs / 60_000)} minutes`)
    }
  }
  return valid
}

/**
 * With `unchanged`, the routine is written only if the check accepts the stored version, read inside
 * the file's write chain as `writeSkill` does. False means the check refused and nothing was written.
 */
export async function writeRoutine(
  dataDir: string,
  botId: string,
  routine: Routine,
  limits: RoutineLimits = DEFAULT_ROUTINE_LIMITS,
  unchanged?: (stored: Routine | null) => boolean,
): Promise<boolean> {
  const valid = validateRoutine(routine, limits)
  // A routine is a schedule for a skill. Saved for a skill that does not exist, it would arm a run
  // with one line of instructions; the bot's own tool checks the same before it saves. A routine
  // that is off arms nothing, so it may be written whatever became of its skill: turning a routine
  // off must not fail because its skill is gone.
  if (valid.enabled && (await readSkill(dataDir, botId, valid.skill)) === null) throw new Error(`there is no skill named ${valid.skill}; save the skill first`)
  const fields: Record<string, string> = { name: valid.name, skill: valid.skill }
  if (valid.schedule !== null) fields.schedule = valid.schedule
  if (valid.event !== null) fields.event = valid.event
  fields.enabled = valid.enabled ? 'true' : 'false'
  const path = join(routinesDir(dataDir, botId), valid.name + '.md')
  return withFileLock(path, async () => {
    if (unchanged && !unchanged(await readRoutine(dataDir, botId, valid.name))) return false
    await writeFileAtomic(path, serializeFrontmatter(fields, valid.body))
    return true
  })
}
