/** Describe cleanup-only failures while preserving the failures in observation order. */
export function cleanupFailure(failures: readonly unknown[], message: string): unknown {
  if (failures.length === 1) return failures[0]
  const details = failures.map((error) => (error instanceof Error ? error.message : String(error)))
  return new Error([message, ...details].join('\n'), { cause: failures })
}

/**
 * @throws {AggregateError} When the operation and cleanup both failed, with the operation first.
 */
export function throwIfOperationFailed(
  primary: { error: unknown } | undefined,
  cleanupFailures: readonly unknown[],
  message: string
): void {
  if (primary) {
    if (cleanupFailures.length)
      throw new AggregateError([primary.error, ...cleanupFailures], message)
    throw primary.error
  }
  if (cleanupFailures.length) throw cleanupFailure(cleanupFailures, message)
}
