import { Exception } from '@adonisjs/core/exceptions'

function invalid(): never {
  throw new Exception('Only a display name and current password are allowed.', {
    status: 422,
    code: 'E_DEMO_PROFILE_INVALID',
  })
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}

function keysOnly(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid()
}

export function mapProfileFields(input: unknown): { fullName: string } {
  const fields = record(input)
  keysOnly(fields, ['fullName'])
  if (typeof fields.fullName !== 'string') invalid()
  const fullName = fields.fullName.trim()
  if (fullName.length < 1 || fullName.length > 80) invalid()
  return { fullName }
}

export function parseProfileInput(input: unknown): {
  currentPassword?: string
  registrationData: { fullName: string }
} {
  const body = record(input)
  keysOnly(body, ['currentPassword', 'registrationData'])
  if (
    'currentPassword' in body &&
    (typeof body.currentPassword !== 'string' || body.currentPassword.length === 0)
  )
    invalid()
  const registrationData = mapProfileFields(body.registrationData)
  // Missing proof reaches Kit unchanged, where identity confirmation returns its stable 403 code.
  return {
    ...('currentPassword' in body ? { currentPassword: body.currentPassword as string } : {}),
    registrationData,
  }
}
