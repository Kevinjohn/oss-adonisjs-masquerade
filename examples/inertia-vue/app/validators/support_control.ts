import vine from '@vinejs/vine'

/** Preserve untrusted controls for the package's canonical validation and audit boundary. */
export const supportControlValidator = vine.create(
  vine
    .object({
      targetId: vine.any().nullable().optional(),
      reason: vine.any().nullable().optional(),
      access: vine.any().nullable().optional(),
      _masqueradeContext: vine.any().nullable().optional(),
      _csrf: vine.any().nullable().optional(),
    })
    .allowUnknownProperties()
)
