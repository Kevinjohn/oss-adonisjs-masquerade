export function isBoundedString(value: unknown, bytes: number): value is string {
  return (
    typeof value === 'string' &&
    value.isWellFormed() &&
    value.length > 0 &&
    Buffer.byteLength(value) <= bytes &&
    // Identifiers must not contain control characters.
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  )
}
