export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function optString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function optFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
