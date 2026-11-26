import env from '#start/env'

export default {
  environment: {
    nodeEnv: env.get('NODE_ENV'),
    dbClient: process.env.DB_CLIENT,
  },
  startRequests: env.get('MASQUERADE_START_REQUESTS') ?? 10,
  stopRequests: env.get('MASQUERADE_STOP_REQUESTS') ?? 10,
}
