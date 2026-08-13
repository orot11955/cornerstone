'use client'

import { getBrowserAuthApi } from '../../api/browser'
import { AuthForm } from '../auth/auth-form'
import { AuthShell } from '../auth/auth-shell'
import { safeReturnPath } from '../../auth/redirect'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  )
}

function LoginContent() {
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const next = safeReturnPath(searchParams.get('next'))
  return (
    <AuthShell title="로그인" description="Cornerstone 계정으로 계속합니다.">
      <AuthForm
        fields={[
          { name: 'email', label: '이메일', type: 'email', autoComplete: 'email' },
          {
            name: 'password',
            label: '비밀번호',
            type: 'password',
            autoComplete: 'current-password',
          },
        ]}
        submitLabel="로그인"
        onSubmit={async (values) => {
          queryClient.removeQueries({ queryKey: ['auth'] })
          await getBrowserAuthApi().auth.login({
            email: values.email ?? '',
            password: values.password ?? '',
          })
          queryClient.removeQueries({ queryKey: ['auth'] })
          return next
        }}
      />
    </AuthShell>
  )
}
