export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export class FileIOError extends Error {
  public readonly filePath: string
  public readonly code: string

  constructor(message: string, filePath: string, code = 'FILE_IO_ERROR') {
    super(message)
    this.name = 'FileIOError'
    this.filePath = filePath
    this.code = code
  }
}

export class ToolError extends Error {
  public readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'ToolError'
    this.code = code
  }
}
