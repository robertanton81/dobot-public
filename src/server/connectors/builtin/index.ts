import type { BuiltinConnector } from '../types'
import { botMailbox } from './bot-mailbox'
import { calcomPublic } from './calcom-public'
import { mapy } from './mapy'
import { wikipedia } from './wikipedia'

/** Every built-in connector, in the order the prompt lists them. */
export const BUILTINS: BuiltinConnector[] = [wikipedia, mapy, calcomPublic, botMailbox]
