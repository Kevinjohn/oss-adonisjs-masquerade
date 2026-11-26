import vine from '@vinejs/vine'

export const preferenceValidator = vine.create({
  emailUpdates: vine.enum(['0', '1']),
})
