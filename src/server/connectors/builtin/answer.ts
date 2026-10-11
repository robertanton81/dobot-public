import type { z } from 'zod'
import { ConnectorError } from '../types'

// A service's answer is a stranger's data: it is read through a schema of the fields the tool uses,
// and a body that is not JSON, or not that shape, becomes an error the model can read.

export async function readAnswer<S extends z.ZodType>(res: Response, schema: S, service: string): Promise<z.infer<S>> {
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new ConnectorError(`${service} answered something that is not JSON`)
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new ConnectorError(`${service} answered in a shape this connector does not know`)
  return parsed.data
}
