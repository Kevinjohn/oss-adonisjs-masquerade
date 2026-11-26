export class ConsumerCommandError extends Error {
  constructor(
    readonly commandName: string,
    readonly output: string,
    readonly primaryError: unknown,
    readonly cleanupErrors: unknown[],
    readonly logPath: string
  ) {
    const details = [primaryError, ...cleanupErrors]
      .filter((error) => error !== undefined)
      .map(describeError)
    super(`${commandName} failed; see ${logPath}\n${details.join('\n')}\n${output.slice(-5000)}`)
  }
}

function describeError(error: unknown): string {
  if (error instanceof AggregateError) {
    return [error.message, ...[...error.errors].map(describeError)].join('\n')
  }
  return error instanceof Error ? error.message : String(error)
}
