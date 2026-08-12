import Link from 'next/link'
import { Container, Heading, Panel, Stack, Text } from '@cornerstone/ui'
import { getWebConfig } from '../config/web'
import { translate } from '../i18n'

export default function NotFound() {
  const { locale } = getWebConfig()
  return (
    <main>
      <Container size="sm" gutter="4">
        <Panel variant="outlined" padding={{ base: '6', md: '8' }}>
          <Stack gap="4">
            <Text tone="muted">404</Text>
            <Heading as="h1" size="xl">
              {translate(locale, 'error.notFound.title')}
            </Heading>
            <Text as="p" tone="muted">
              {translate(locale, 'error.notFound.description')}
            </Text>
            <Link href="/">{translate(locale, 'error.home')}</Link>
          </Stack>
        </Panel>
      </Container>
    </main>
  )
}
