import { listArtifacts, readArtifact, writeArtifact } from './artifacts'
import { createBot, listBots, makeDataDirPrivate, readBot, updateBot, writeBot } from './bot'
import { appendChat, readChat, updateChatCard } from './chat'
import { readConnections, writeConnection } from './connections'
import { appendMemory, readMemory, writeMemory } from './memory'
import { artifactsDir, botDir, workspaceDir } from './paths'
import { readRules } from './rules'
import { DEFAULT_ROUTINE_LIMITS, listRoutines, readRoutine, readRoutineReceipt, writeRoutine, writeRoutineReceipt, type RoutineLimits } from './routines'
import { appendRunEvent, listOpenRuns, listRunCosts, listRunSummaries, readRunEvents, readShot, startRun, writeShot } from './runs'
import { listSkills, readSkill, writeSkill } from './skills'
import type { Routine } from './types'

export * from './types'
export { parseFrontmatter, serializeFrontmatter } from './frontmatter'
export { assertSlug, isNotFound, writeFileAtomic } from './paths'
export { SHOT_HASH } from './runs'
export { DEFAULT_ROUTINE_LIMITS, DEFAULT_ROUTINE_MIN_INTERVAL_MINUTES, validateRoutine, type RoutineLimits } from './routines'
export { assertArtifactName } from './artifacts'
export { clipStatus, STATUS_LINE_MAX } from './status'
export type { ChatInput } from './chat'
export { splitChatText } from './chat'
export type { CreateBotInput } from './bot'
export type { RunCost, RunSummary } from './runs'

/** The bot folder, bound to one data directory. Nothing else touches the disk. `routineLimits` apply when a routine is saved. */
export function createStore(dataDir: string, routineLimits: RoutineLimits = DEFAULT_ROUTINE_LIMITS) {
  return {
    dataDir,
    makePrivate: makeDataDirPrivate.bind(null, dataDir),
    botDir: (botId: string) => botDir(dataDir, botId),
    workspaceDir: (botId: string) => workspaceDir(dataDir, botId),
    artifactsDir: (botId: string) => artifactsDir(dataDir, botId),
    listBots: listBots.bind(null, dataDir),
    readBot: readBot.bind(null, dataDir),
    writeBot: writeBot.bind(null, dataDir),
    createBot: createBot.bind(null, dataDir),
    updateBot: updateBot.bind(null, dataDir),
    appendChat: appendChat.bind(null, dataDir),
    readChat: readChat.bind(null, dataDir),
    updateChatCard: updateChatCard.bind(null, dataDir),
    startRun: startRun.bind(null, dataDir),
    appendRunEvent: appendRunEvent.bind(null, dataDir),
    readRunEvents: readRunEvents.bind(null, dataDir),
    writeShot: writeShot.bind(null, dataDir),
    readShot: readShot.bind(null, dataDir),
    listOpenRuns: listOpenRuns.bind(null, dataDir),
    listRunCosts: listRunCosts.bind(null, dataDir),
    listRunSummaries: listRunSummaries.bind(null, dataDir),
    appendMemory: appendMemory.bind(null, dataDir),
    readMemory: readMemory.bind(null, dataDir),
    writeMemory: writeMemory.bind(null, dataDir),
    listSkills: listSkills.bind(null, dataDir),
    readSkill: readSkill.bind(null, dataDir),
    writeSkill: writeSkill.bind(null, dataDir),
    listRoutines: listRoutines.bind(null, dataDir),
    readRoutine: readRoutine.bind(null, dataDir),
    readRoutineReceipt: readRoutineReceipt.bind(null, dataDir),
    writeRoutineReceipt: writeRoutineReceipt.bind(null, dataDir),
    writeRoutine: (botId: string, routine: Routine, unchanged?: (stored: Routine | null) => boolean) => writeRoutine(dataDir, botId, routine, routineLimits, unchanged),
    readRules: readRules.bind(null, dataDir),
    readConnections: readConnections.bind(null, dataDir),
    writeConnection: writeConnection.bind(null, dataDir),
    writeArtifact: writeArtifact.bind(null, dataDir),
    listArtifacts: listArtifacts.bind(null, dataDir),
    readArtifact: readArtifact.bind(null, dataDir),
  }
}

export type Store = ReturnType<typeof createStore>
