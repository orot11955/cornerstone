import { recordUnexpectedError } from './telemetry/browser'

performance.mark('cornerstone:app-init')

window.addEventListener('cornerstone:unexpected-error', (event) => {
  if (!(event instanceof CustomEvent) || !isErrorEventDetail(event.detail)) return
  recordUnexpectedError('/', event.detail.correlationId)
})

function isErrorEventDetail(value: unknown): value is { readonly correlationId?: string } {
  if (typeof value !== 'object' || value === null) return false
  const correlationId = Reflect.get(value, 'correlationId')
  return correlationId === undefined || typeof correlationId === 'string'
}
