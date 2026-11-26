import vine from '@vinejs/vine'

export const masqueradeHistoryValidator = vine.create({
  from: vine.string().optional(),
  to: vine.string().optional(),
  page: vine.string().optional(),
})
