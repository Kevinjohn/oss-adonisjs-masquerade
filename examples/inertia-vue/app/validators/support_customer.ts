import vine from '@vinejs/vine'

export const supportCustomerValidator = vine.create({
  delayMs: vine.number().optional(),
})
