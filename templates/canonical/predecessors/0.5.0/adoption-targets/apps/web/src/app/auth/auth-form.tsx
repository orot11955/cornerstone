'use client'

import { ApiError } from '@cornerstone/api-client/browser'
import { Alert, Button, FormField, Input, Stack, Text } from '@cornerstone/ui'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent, type ReactNode } from 'react'

export interface AuthFormField {
  readonly name: string
  readonly label: string
  readonly type?: 'email' | 'password' | 'text'
  readonly autoComplete?: string
  readonly minLength?: number
}

export function AuthForm({
  fields,
  submitLabel,
  onSubmit,
  children,
}: {
  readonly fields: readonly AuthFormField[]
  readonly submitLabel: string
  readonly onSubmit: (values: Record<string, string>) => Promise<string | void>
  readonly children?: ReactNode
}) {
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)
  const router = useRouter()
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)
    setPending(true)
    const values = Object.fromEntries(
      Array.from(new FormData(event.currentTarget).entries(), ([key, value]) => [
        key,
        String(value),
      ]),
    )
    try {
      const destination = await onSubmit(values)
      if (destination) router.replace(destination)
    } catch (cause) {
      setError(toSafeError(cause))
    } finally {
      setPending(false)
    }
  }
  return (
    <form onSubmit={submit}>
      <Stack gap="4">
        {fields.map((field) => (
          <FormField key={field.name} label={field.label} required>
            {(props) => (
              <Input
                {...props}
                name={field.name}
                type={field.type ?? 'text'}
                autoComplete={field.autoComplete}
                minLength={field.minLength}
                required
                disabled={pending}
              />
            )}
          </FormField>
        ))}
        {children}
        {error ? (
          <Alert tone="danger" title="요청을 완료하지 못했습니다.">
            <Text role="status">{error}</Text>
          </Alert>
        ) : null}
        <Button type="submit" loading={pending} disabled={pending}>
          {submitLabel}
        </Button>
      </Stack>
    </form>
  )
}

function toSafeError(cause: unknown): string {
  if (cause instanceof ApiError) {
    const requestId = cause.response.headers.get('x-request-id')
    return requestId
      ? `요청을 다시 시도해 주세요. 요청 ID: ${requestId}`
      : `요청을 다시 시도해 주세요. (${cause.status})`
  }
  return '요청을 다시 시도해 주세요.'
}
