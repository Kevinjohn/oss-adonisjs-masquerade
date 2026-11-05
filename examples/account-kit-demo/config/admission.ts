import { defineAdmission } from '@kevinjohn/adonisjs-account-kit/admission'

export default defineAdmission({
  approval: {
    required: true,
    // Example only: any admitted account may decide and list every admission. A real host
    // authorizes these for its administrators, as Account Kit's deny-by-default stub expects.
    authorize: {
      decide: async () => true,
      list: async () => true,
    },
  },
})
