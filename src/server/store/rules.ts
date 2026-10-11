import { readFile } from 'node:fs/promises'
import { log } from '../log'
import { isNotFound, rulesFile } from './paths'
import { ApprovalRules, DEFAULT_RULES } from './types'

// Read only. There is no write function on purpose: the user edits approval-rules.json on disk,
// and no tool the model can call is able to change it (invariant 4).

/** A missing or malformed file yields DEFAULT_RULES (everything needs approval) with a warning. */
export async function readRules(dataDir: string, botId: string): Promise<ApprovalRules> {
  let raw: string
  try {
    raw = await readFile(rulesFile(dataDir, botId), 'utf8')
  } catch (e) {
    if (!isNotFound(e)) throw e
    log.warn('approval-rules.json missing; using the default rules', { botId })
    return DEFAULT_RULES
  }
  try {
    const parsed = ApprovalRules.safeParse(JSON.parse(raw))
    if (parsed.success) return parsed.data
    log.warn('approval-rules.json does not match the schema; using the default rules', { botId })
  } catch {
    log.warn('approval-rules.json is not valid JSON; using the default rules', { botId })
  }
  return DEFAULT_RULES
}
