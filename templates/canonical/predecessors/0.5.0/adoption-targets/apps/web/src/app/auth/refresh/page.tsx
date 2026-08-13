'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getBrowserAuthApi } from '../../../api/browser'
import { safeReturnPath } from '../../../auth/redirect'
import { useQueryClient } from '@tanstack/react-query'

export default function RefreshPage() {
  return (
    <Suspense fallback={<main aria-busy="true">세션을 확인하고 있습니다.</main>}>
      <RefreshContent />
    </Suspense>
  )
}

function RefreshContent() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const params = useSearchParams()
  useEffect(() => {
    const next = safeReturnPath(params.get('next'))
    void getBrowserAuthApi()
      .auth.me()
      .then(() => router.replace(next))
      .catch(() => {
        queryClient.removeQueries({ queryKey: ['auth'] })
        router.replace(`/login?next=${encodeURIComponent(next)}`)
      })
  }, [params, queryClient, router])
  return <main aria-busy="true">세션을 확인하고 있습니다.</main>
}
