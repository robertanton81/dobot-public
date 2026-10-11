// Fetch helpers for the API. Every request has a timeout; every failure becomes an Error.

import type { HandbackCode } from '../server/agent/takeover'
import type { BotView } from '../server/bot-view'
import type { RunSummary } from '../server/store/runs'
import type { BotState, Card, ChatMessage, RunEvent } from '../server/store/types'

// What the API sends has the server's own types. They are imported as types only: the build erases
// the import, so no server code reaches the page, and a field renamed on the server fails the
// typecheck here instead of reading as undefined in the browser.
export type { BotState, Card, ChatMessage, RunEvent, RunSummary }
/** The bot as the page sees it. */
export type Bot = BotView
export type HandbackState = { allowed: boolean; reason: string; code: HandbackCode }

export type BotFiles = {
  memory: string
  skills: { name: string; text: string }[]
  routines: { name: string; text: string }[]
  rules: string
  artifacts: string[]
}

const TIMEOUT_MS = 15_000

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'content-type': 'application/json', ...init.headers } })
  if (res.status === 204) return undefined as T
  const body: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = typeof body === 'object' && body !== null && 'error' in body ? String((body as { error: unknown }).error) : `http ${res.status}`
    throw new Error(error)
  }
  return body as T
}

export const api = {
  listBots: () => request<{ bots: Bot[] }>('/api/bots'),
  createBot: (input: { name: string; avatar?: string; persona: string }) =>
    request<{ bot: Bot }>('/api/bots', { method: 'POST', body: JSON.stringify(input) }),
  getBot: (id: string) => request<{ bot: Bot; chat: ChatMessage[] }>(`/api/bots/${id}`),
  sendMessage: (id: string, text: string) =>
    request<{ message: ChatMessage; answered: boolean; runId?: string }>(`/api/bots/${id}/messages`, { method: 'POST', body: JSON.stringify({ text }) }),
  decide: (id: string, approvalId: string, decision: 'allow' | 'deny') =>
    request<void>(`/api/bots/${id}/approvals/${approvalId}`, { method: 'POST', body: JSON.stringify({ decision }) }),
  streamUrl: (id: string, mode: 'view' | 'interactive' = 'view') => request<{ url: string }>(`/api/bots/${id}/stream?mode=${mode}`),
  requestTakeover: (id: string) => request<void>(`/api/bots/${id}/takeover`, { method: 'POST', body: '{}' }),
  stop: (id: string) => request<void>(`/api/bots/${id}/stop`, { method: 'POST', body: '{}' }),
  handbackState: (id: string) => request<HandbackState>(`/api/bots/${id}/takeover/state`),
  handback: (id: string, force = false) => request<void>(`/api/bots/${id}/takeover/handback`, { method: 'POST', body: JSON.stringify({ force }) }),
  listRuns: (id: string) => request<{ runs: RunSummary[] }>(`/api/bots/${id}/runs`),
  getRun: (id: string, runId: string) => request<{ events: RunEvent[] }>(`/api/bots/${id}/runs/${runId}`),
  getFiles: (id: string) => request<BotFiles>(`/api/bots/${id}/files`),
  putMemory: (id: string, text: string, base: string) => request<{ text: string }>(`/api/bots/${id}/memory`, { method: 'PUT', body: JSON.stringify({ text, base }) }),
  putSkill: (id: string, name: string, text: string, base: string) => request<{ text: string }>(`/api/bots/${id}/skills/${name}`, { method: 'PUT', body: JSON.stringify({ text, base }) }),
  putRoutine: (id: string, name: string, text: string, base: string) => request<{ text: string }>(`/api/bots/${id}/routines/${name}`, { method: 'PUT', body: JSON.stringify({ text, base }) }),
}
