const PREFIX = '[the-i18n-mcp]'

function formatMessage(level: string, message: string): string {
  return `${PREFIX} [${level}] ${message}`
}

export const log = {
  info(message: string, ...args: unknown[]) {
    console.error(formatMessage('info', message), ...args)
  },
  warn(message: string, ...args: unknown[]) {
    console.error(formatMessage('warn', message), ...args)
  },
  error(message: string, ...args: unknown[]) {
    console.error(formatMessage('error', message), ...args)
  },
  debug(message: string, ...args: unknown[]) {
    if (process.env.DEBUG) {
      console.error(formatMessage('debug', message), ...args)
    }
  },
}
