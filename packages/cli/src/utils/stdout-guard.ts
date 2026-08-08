const realStdoutWrite = process.stdout.write.bind(process.stdout)

/**
 * Redirect all subsequent process.stdout writes to stderr. Third-party code
 * loaded during config detection (e.g. Nuxt modules like nuxt-site-config)
 * logs straight to stdout, which corrupts the machine-readable JSON output
 * that CI pipes into jq. Command results still reach the real stdout via
 * writeResult below.
 */
export function guardStdout(): void {
  process.stdout.write = ((...args: Parameters<typeof process.stdout.write>) =>
    process.stderr.write(...args)) as typeof process.stdout.write
}

/** Write to the real stdout, bypassing the guard. */
export function writeResult(text: string): void {
  realStdoutWrite(text)
}
