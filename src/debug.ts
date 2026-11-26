import { debuglog } from 'node:util'

export const debug = debuglog('adonisjs:masquerade')

/** Report observer failures without exposing the observer's exception or request data. */
export function reportObserverError() {
  debug('E_MASQUERADE_OBSERVER_FAILED')
}

/** Diagnostic output used when the application does not supply a logger. */
export const debugLogger = {
  info(event: object) {
    debug('Masquerade transition %o', event)
  },
  error(event: object) {
    debug('Masquerade diagnostic %o', event)
  },
}
