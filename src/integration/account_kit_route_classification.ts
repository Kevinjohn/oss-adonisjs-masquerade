/** Classify the committed route name for the global Account Kit blocker and route report. */
export function classifyAccountKitRoute(name: string | undefined): 'host' | 'managed' | 'exempt' {
  if (!name?.startsWith('accountKit.')) return 'host'
  if (name === 'accountKit.account.logout' || name === 'accountKit.auth.csrf') return 'exempt'
  return 'managed'
}
