import { formatForFile } from './formats'

export async function readLocale(filePath: string): Promise<Record<string, unknown>> {
  return formatForFile(filePath).read(filePath)
}

export async function writeLocale(
  filePath: string,
  data: Record<string, unknown>,
): Promise<void> {
  return formatForFile(filePath).write(filePath, data)
}

export async function mutateLocale(
  filePath: string,
  mutate: (data: Record<string, unknown>) => void,
): Promise<void> {
  return formatForFile(filePath).mutate(filePath, mutate)
}
