'use client'

import { useSyncExternalStore } from 'react'
import { Alert } from '@cornerstone/ui'
import { translate, type Locale } from '../i18n'

export function NetworkStatus({ locale }: { readonly locale: Locale }) {
  const online = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  if (online) return null
  return (
    <Alert tone="warning" title={translate(locale, 'network.offline.title')}>
      {translate(locale, 'network.offline.description')}
    </Alert>
  )
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener('online', onStoreChange)
  window.addEventListener('offline', onStoreChange)
  return () => {
    window.removeEventListener('online', onStoreChange)
    window.removeEventListener('offline', onStoreChange)
  }
}

function getSnapshot(): boolean {
  return navigator.onLine
}

function getServerSnapshot(): boolean {
  return true
}
