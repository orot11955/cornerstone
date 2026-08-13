'use client'

import { getBrowserAuthApi } from '../../../api/browser'
import { AuthForm } from '../../auth/auth-form'
import { AuthShell } from '../../auth/auth-shell'
import { Suspense, useEffect, useState } from 'react'
import { parseActionTokenFragment } from '../../../auth/action-token'

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  )
}

function ResetPasswordContent() {
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
      <AuthShell title="새 비밀번호 설정" description="재설정 링크를 확인하고 있습니다.">
        <span aria-busy="true">잠시만 기다려 주세요.</span>
      </AuthShell>
    )
  if (!token)
    return (
      <AuthShell title="새 비밀번호 설정" description="유효한 재설정 링크가 필요합니다.">
        <span role="status">링크가 없거나 유효하지 않습니다.</span>
      </AuthShell>
    )
  return (
    <AuthShell title="새 비밀번호 설정" description="새 비밀번호를 설정합니다.">
      <AuthForm
        fields={[
          {
            name: 'newPassword',
            label: '새 비밀번호',
            type: 'password',
            autoComplete: 'new-password',
            minLength: 12,
          },
        ]}
        submitLabel="비밀번호 변경"
        onSubmit={async (values) => {
          await getBrowserAuthApi().auth.resetPassword({
            token,
            newPassword: values.newPassword ?? '',
          })
          return '/login'
        }}
      />
    </AuthShell>
  )
}
