'use client'

import { useEffect } from 'react'
import { Alert, Button, Container, Heading, Panel, Stack, Text } from '@cornerstone/ui'
import { resolveCorrelationId } from '../errors/correlation'
import { resolveLocale, translate } from '../i18n'

interface ErrorPageProps {
  readonly error: Error & { readonly digest?: string }
  readonly reset: () => void
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const correlationId = resolveCorrelationId(error.digest)
  const locale = resolveLocale(process.env.NEXT_PUBLIC_APP_LOCALE)

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('cornerstone:unexpected-error', {
        detail: correlationId ? { correlationId } : {},
      }),
    )
  }, [correlationId])

  return (
    <main>
      <Container size="sm" gutter="4">
        <Panel variant="outlined" padding={{ base: '6', md: '8' }}>
          <Stack gap="4">
            <Heading as="h1" size="xl">
              {translate(locale, 'error.unexpected.title')}
            </Heading>
            <Text as="p" tone="muted">
              {translate(locale, 'error.unexpected.description')}
            </Text>
            {correlationId ? <Alert title="문의 식별자">{correlationId}</Alert> : null}
            <Button onClick={reset}>{translate(locale, 'common.retry')}</Button>
          </Stack>
        </Panel>
      </Container>
    </main>
  )
}
