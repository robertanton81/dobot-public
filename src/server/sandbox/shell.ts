/** POSIX single-quote quoting: the result is one inert argument, whatever the string holds. */
export function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}
