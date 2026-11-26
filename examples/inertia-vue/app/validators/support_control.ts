import vine from '@vinejs/vine'

/** Preserve untrusted controls for the package's canonical validation and audit boundary. */
export const supportControlValidator = vine.create(
  vine
    .object({
      targetId: vine.any().optional(),
      reason: vine.any().optional(),
      access: vine.any().optional(),
      _masqueradeContext: vine.any().optional(),
      _csrf: vine.any().optional(),
    })
    .allowUnknownProperties()
)
