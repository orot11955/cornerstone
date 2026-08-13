'use client'

import { Alert, Button, FormField, Heading, Input, Panel, Stack, Text } from '@cornerstone/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getBrowserAuthApi } from '../../../api/browser'

export function SecurityClient() {
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const router = useRouter()
  const queryClient = useQueryClient()
  const sessionQuery = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: async () => (await getBrowserAuthApi().auth.sessions()).items,
    staleTime: 0,
  })
  const sessions = sessionQuery.data ?? []
  async function revoke(id: string) {
    setBusy(true)
    try {
      await getBrowserAuthApi().auth.revokeSession(id)
      await queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] })
    } catch {
      setError('세션을 종료하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  async function revokeAll() {
    setBusy(true)
    try {
      await getBrowserAuthApi().auth.revokeAllSessions()
      queryClient.removeQueries({ queryKey: ['auth'] })
      router.replace('/login')
    } catch {
      setError('세션을 종료하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  async function logout() {
    setBusy(true)
    try {
      await getBrowserAuthApi().auth.logout()
      queryClient.removeQueries({ queryKey: ['auth'] })
      router.replace('/login')
    } catch {
      setError('로그아웃하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  async function recentAuth(form: HTMLFormElement) {
    const password = String(new FormData(form).get('password') ?? '')
    setBusy(true)
    try {
      await getBrowserAuthApi().auth.confirmRecentAuthentication({ password })
      form.reset()
    } catch {
      setError('최근 인증을 확인하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Stack gap="6">
      <Panel variant="outlined" padding="5">
        <Stack gap="4">
          <Heading as="h2" size="md">
            비밀번호 변경
          </Heading>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              setBusy(true)
              void getBrowserAuthApi()
                .auth.changePassword({
                  currentPassword: String(data.get('currentPassword') ?? ''),
                  newPassword: String(data.get('newPassword') ?? ''),
                })
                .then(() => {
                  queryClient.removeQueries({ queryKey: ['auth'] })
                  router.replace('/login')
                })
                .catch(() => setError('비밀번호를 변경하지 못했습니다.'))
                .finally(() => setBusy(false))
            }}
          >
            <Stack gap="3">
              <FormField label="현재 비밀번호" required>
                {(props) => (
                  <Input
                    {...props}
                    name="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    required
                    disabled={busy}
                  />
                )}
              </FormField>
              <FormField label="새 비밀번호" required>
                {(props) => (
                  <Input
                    {...props}
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    required
                    disabled={busy}
                  />
                )}
              </FormField>
              <Button type="submit" loading={busy}>
                비밀번호 변경
              </Button>
            </Stack>
          </form>
        </Stack>
      </Panel>
      <Panel variant="outlined" padding="5">
        <Stack gap="3">
          <Heading as="h2" size="md">
            최근 인증
          </Heading>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void recentAuth(event.currentTarget)
            }}
          >
            <Stack gap="3">
              <FormField label="비밀번호" required>
                {(props) => (
                  <Input
                    {...props}
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    disabled={busy}
                  />
                )}
              </FormField>
              <Button type="submit" loading={busy}>
                최근 인증 확인
              </Button>
            </Stack>
          </form>
        </Stack>
      </Panel>
      <Panel variant="outlined" padding="5">
        <Stack gap="4">
          <Heading as="h2" size="md">
            활성 세션
          </Heading>
          {sessionQuery.isLoading ? <Text tone="muted">세션을 불러오는 중입니다.</Text> : null}
          {sessionQuery.isError ? <Text role="status">세션을 불러오지 못했습니다.</Text> : null}
          {sessions.length === 0 ? (
            <Text tone="muted">활성 세션이 없습니다.</Text>
          ) : (
            sessions.map((session) => (
              <Stack key={session.id} gap="1">
                <Text>
                  {session.deviceLabel ?? '알 수 없는 기기'}
                  {session.current ? ' (현재 세션)' : ''}
                </Text>
                <Text size="sm" tone="muted">
                  최근 사용: {new Date(session.lastSeenAt).toLocaleString()}
                </Text>
                {!session.current ? (
                  <Button variant="ghost" disabled={busy} onClick={() => void revoke(session.id)}>
                    이 세션 종료
                  </Button>
                ) : null}
              </Stack>
            ))
          )}
          <Button tone="danger" variant="outline" disabled={busy} onClick={() => void revokeAll()}>
            모든 세션 종료
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void logout()}>
            로그아웃
          </Button>
        </Stack>
      </Panel>
      {error ? (
        <Alert tone="danger" title="요청을 완료하지 못했습니다.">
          <Text role="status">{error}</Text>
        </Alert>
      ) : null}
    </Stack>
  )
}
