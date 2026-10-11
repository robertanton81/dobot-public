import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { log } from '../log'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter'
import { assertSlug, isNotFound, skillsDir, withFileLock, writeFileAtomic } from './paths'
import { Skill, SLUG } from './types'

export async function listSkills(dataDir: string, botId: string): Promise<Skill[]> {
  let entries: string[]
  try {
    entries = await readdir(skillsDir(dataDir, botId))
  } catch (e) {
    if (isNotFound(e)) return []
    throw e
  }
  const skills: Skill[] = []
  for (const file of entries.sort()) {
    if (!file.endsWith('.md')) continue
    // A file somebody put there under a name the platform would never give is not one of the bot's skills.
    if (!SLUG.test(file.slice(0, -3))) {
      log.warn('skipping a file whose name is not a valid name', { botId, folder: 'skills', file })
      continue
    }
    const skill = await readSkill(dataDir, botId, file.slice(0, -3))
    if (skill) skills.push(skill)
  }
  return skills
}

/** null when the file is missing or does not parse (logged). */
export async function readSkill(dataDir: string, botId: string, name: string): Promise<Skill | null> {
  assertSlug(name)
  let text: string
  try {
    text = await readFile(join(skillsDir(dataDir, botId), name + '.md'), 'utf8')
  } catch (e) {
    if (isNotFound(e)) return null
    throw e
  }
  const { fields, body } = parseFrontmatter(text)
  const parsed = Skill.safeParse({ name: fields.name ?? name, description: fields.description ?? '', body })
  if (!parsed.success) {
    log.warn('skill file does not parse', { botId, name })
    return null
  }
  return parsed.data
}

/**
 * With `unchanged`, the skill is written only if the check accepts the stored version; the read, the
 * check and the write run inside the file's write chain, so the bot's own save in between is never
 * overwritten unseen. False means the check refused and nothing was written.
 */
export async function writeSkill(dataDir: string, botId: string, skill: Skill, unchanged?: (stored: Skill | null) => boolean): Promise<boolean> {
  const valid = Skill.parse(skill)
  assertSlug(valid.name)
  const text = serializeFrontmatter({ name: valid.name, description: valid.description }, valid.body)
  const path = join(skillsDir(dataDir, botId), valid.name + '.md')
  return withFileLock(path, async () => {
    if (unchanged && !unchanged(await readSkill(dataDir, botId, valid.name))) return false
    await writeFileAtomic(path, text)
    return true
  })
}
