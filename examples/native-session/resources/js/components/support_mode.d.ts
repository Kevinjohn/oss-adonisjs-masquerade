interface SupportIntent {
  hidden: boolean
  querySelectorAll(selector: string): { disabled: boolean }[]
}
interface SupportElement {
  closest(selector: string): SupportIntent | null
}
interface SupportNotice extends SupportElement {
  hidden: boolean
  textContent: string
  focus(): void
}
/** Elements read by each selector in the support-mode widget. */
export interface SupportNodes {
  '[data-mode-label]': { textContent: string }
  '[data-mode-badge]': { textContent: string; classList: { remove(name: string): void } }
  '[data-mode-notice]': SupportNotice
}
interface SupportRoot {
  dataset: { expiresAt: string; contextToken: string }
  classList: { remove(name: string): void }
  querySelector<K extends keyof SupportNodes>(selector: K): SupportNodes[K]
}
/** Browser surface read by the support-mode widget and its isolated tests. */
export interface SupportDocument {
  visibilityState: string
  activeElement: SupportElement | null
  querySelector(selector: string): SupportRoot | null
  querySelectorAll(selector: string): SupportIntent[]
  addEventListener(name: string, callback: () => void | Promise<void>): void
}
/** Initialize deadline and visible-return checks for the rendered support intent. */
export function initSupportMode(options?: {
  documentRef?: SupportDocument
  windowRef?: {
    addEventListener(name: string, callback: (event: { persisted: boolean }) => void): void
  }
  fetchStatus?: (
    path: string,
    options: RequestInit
  ) => Promise<{ ok: boolean; json(): Promise<unknown> }>
  now?: () => number
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> | number | void
}): void
