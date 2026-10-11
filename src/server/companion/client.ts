import { cleanedExcerpt, errorFields, log } from '../log'
import { ElementInfo, Health, PageState, type CompanionPort, type Point } from '../sandbox/port'

// HTTP client for companion.py, which runs inside the sandbox and speaks CDP to Chrome on
// localhost. The port is public (E2B proxies it with no authentication of its own), so the
// per-sandbox bearer token is what protects it. The token is held in memory and never logged.

const REQUEST_TIMEOUT_MS = 5_000
// /set-files can wait a full file-chooser deadline inside the companion (5 s) on top of half a
// dozen CDP round trips, so the shared 5 s would abort the request before the companion could
// answer — and the model would see a transport error instead of the readable "no file input".
const SET_FILES_TIMEOUT_MS = 25_000

function unknown(reason: string): ElementInfo {
  return { target: 'unknown', reason, url: '', title: '' }
}

export class CompanionClient implements CompanionPort {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async request(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
    return fetch(this.baseUrl + path, {
      method,
      headers: {
        authorization: 'Bearer ' + this.token,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  }

  /** Never throws: an unreachable companion is `{ ok: false, cdp: false }`. */
  async health(): Promise<Health> {
    try {
      const res = await this.request('GET', '/health')
      if (res.status !== 200) return { ok: false, cdp: false }
      const parsed = Health.safeParse(await res.json())
      return parsed.success ? parsed.data : { ok: false, cdp: false }
    } catch {
      return { ok: false, cdp: false }
    }
  }

  /** Fails closed: any transport, status or parse failure becomes an unknown target. */
  private async element(path: string, body: unknown): Promise<ElementInfo> {
    try {
      const res = await this.request('POST', path, body)
      if (res.status !== 200) return unknown('http ' + res.status)
      const parsed = ElementInfo.safeParse(await res.json())
      if (!parsed.success) {
        log.warn('companion returned a malformed element', { path })
        return unknown('malformed response')
      }
      return parsed.data
    } catch (e) {
      return unknown(errorFields(e).errorName)
    }
  }

  elementAt(p: Point): Promise<ElementInfo> {
    return this.element('/element-at', { x: p[0], y: p[1] })
  }

  activeElement(): Promise<ElementInfo> {
    return this.element('/active-element', {})
  }

  async pageState(): Promise<PageState> {
    const res = await this.request('POST', '/page-state', {})
    if (res.status !== 200) {
      const detail = await res.text().catch(() => '')
      throw new Error('companion page-state failed: http ' + res.status + (detail ? ' ' + cleanedExcerpt(detail, 300) : ''))
    }
    const parsed = PageState.safeParse(await res.json())
    if (!parsed.success) throw new Error('companion page-state returned a malformed response')
    return parsed.data
  }

  async setFiles(p: Point, sandboxPath: string, opts: { click: boolean }): Promise<void> {
    const res = await this.request('POST', '/set-files', { x: p[0], y: p[1], path: sandboxPath, click: opts.click }, SET_FILES_TIMEOUT_MS)
    if (res.status !== 200) {
      const detail = await res.text().catch(() => '')
      throw new Error('companion set-files failed: http ' + res.status + (detail ? ' ' + cleanedExcerpt(detail, 200) : ''))
    }
  }
}
