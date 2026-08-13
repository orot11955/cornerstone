'use client'

import { getBrowserAuthApi } from '../../api/browser'
import { AuthForm } from '../auth/auth-form'
import { AuthShell } from '../auth/auth-shell'

export default function RegisterPage() {
  return (
    <AuthShell title="계정 만들기" description="이메일 인증 후 서비스를 사용할 수 있습니다.">
      <AuthForm
        fields={[
          { name: 'email', label: '이메일', type: 'email', autoComplete: 'email' },
          {
            name: 'password',
            label: '비밀번호',
            type: 'password',
            autoComplete: 'new-password',
            minLength: 12,
          },
        ]}
        submitLabel="가입 요청"
        onSubmit={async (values) => {
          await getBrowserAuthApi().auth.register({
            email: values.email ?? '',
            password: values.password ?? '',
          })
          return '/verify-email'
        }}
      />
    </AuthShell>
  )
}
