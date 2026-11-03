/** Minimal DOM contract used by the JSON example and its isolated UI tests. */
export interface ClientElement {
  dataset: Record<string, string | undefined>
  hidden: boolean
  disabled: boolean
  textContent: string
  value: string
  addEventListener(name: string, callback: ClientListener): void
  focus(): void
  reset(): void
}

export type ClientListener = (event: { preventDefault(): void }) => void | Promise<void>

/** Same-origin request options constructed by the JSON example. */
export interface ClientRequest {
  method: string
  headers: Record<string, string>
  credentials: 'same-origin'
  cache: 'no-store'
  redirect: 'manual'
  body?: string
}

/** Initialize the example with browser objects or controlled test doubles. */
export function initJsonClient(options?: {
  documentRef?: {
    visibilityState: string
    getElementById(id: string): ClientElement | null
    querySelector(selector: string): { value: string } | null
    addEventListener(name: string, callback: ClientListener): void
  } | null
  fetchRef?: (path: string, options: ClientRequest) => Promise<Response>
  now?: () => number
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> | number | void
}): void
