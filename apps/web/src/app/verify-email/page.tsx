'use client'

import { getBrowserAuthApi } from '../../api/browser'
import { AuthForm } from '../auth/auth-form'
import { AuthShell } from '../auth/auth-shell'
import { useRouter } from 'next/navigation'
import { Button, Stack, Text } from '@cornerstone/ui'
import { Suspense, useEffect, useState } from 'react'
import { parseActionTokenFragment } from '../../auth/action-token'

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  )
}

function VerifyEmailContent() {
  const router = useRouter()
  const [sent, setSent] = useState(false)
  const [token, setToken] = useState<string>()
  const [checked, setChecked] = useState(false)
  useEffect(() => {
    const actionToken = parseActionTokenFragment(window.location.hash)
    window.history.replaceState(null, '', window.location.pathname)
    const timer = window.setTimeout(() => {
      setToken(actionToken)
      setChecked(true)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])
  if (!checked)
    return (
      <AuthShell title="이메일 인증" description="인증 링크를 확인하고 있습니다.">
        <Text aria-busy="true">잠시만 기다려 주세요.</Text>
      </AuthShell>
    )
  if (token)
    return (
      <AuthShell title="이메일 인증" description="인증 토큰을 확인했습니다.">
        <AuthForm
          fields={[]}
          submitLabel="이메일 인증"
          onSubmit={async () => {
            await getBrowserAuthApi().auth.verifyEmail({ token })
            router.replace('/login')
          }}
        />
      </AuthShell>
    )
  return (
    <AuthShell title="이메일 인증" description="인증 메일을 다시 보낼 수 있습니다.">
      <Stack gap="4">
        <Text>인증 링크를 열어 계정을 활성화하세요.</Text>
        <AuthForm
          fields={[{ name: 'email', label: '이메일', type: 'email', autoComplete: 'email' }]}
          submitLabel="인증 메일 재발송"
          onSubmit={async (values) => {
            await getBrowserAuthApi().auth.resendVerification({ email: values.email ?? '' })
            setSent(true)
          }}
        />
        {sent ? <Text role="status">인증 메일 요청을 접수했습니다.</Text> : null}
        <Button variant="ghost" onClick={() => router.replace('/login')}>
          로그인으로 이동
        </Button>
      </Stack>
    </AuthShell>
  )
}
