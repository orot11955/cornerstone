'use client'

import { getBrowserAuthApi } from '../../../api/browser'
import { AuthForm } from '../../auth/auth-form'
import { AuthShell } from '../../auth/auth-shell'

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="비밀번호 재설정" description="계정 이메일로 재설정 링크를 요청합니다.">
      <AuthForm
        fields={[{ name: 'email', label: '이메일', type: 'email', autoComplete: 'email' }]}
        submitLabel="재설정 링크 요청"
        onSubmit={async (values) => {
          await getBrowserAuthApi().auth.forgotPassword({ email: values.email ?? '' })
        }}
      />
    </AuthShell>
  )
}
