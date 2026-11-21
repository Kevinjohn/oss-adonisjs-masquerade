import type { ObserverEvent } from '../types.js'

/** Transition event names supplied to AdonisJS applications by the package provider. */
declare module '@adonisjs/core/types' {
  interface EventsList {
    'masquerade:started': ObserverEvent
    'masquerade:stopped': ObserverEvent
    'masquerade:expired': ObserverEvent
    'masquerade:invalidated': ObserverEvent
  }
}
