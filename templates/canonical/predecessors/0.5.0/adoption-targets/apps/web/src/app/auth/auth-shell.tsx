import type { ReactNode } from 'react'
import { Box, Container, Heading, Panel, Stack, Text } from '@cornerstone/ui'

export function AuthShell({
  title,
  description,
  children,
}: {
  readonly title: string
  readonly description: string
  readonly children: ReactNode
}) {
  return (
    <main>
      <Container size="sm" gutter="4">
        <Box padding={{ base: '6', md: '10' }}>
          <Panel variant="outlined" padding={{ base: '5', md: '6' }}>
            <Stack gap="6">
              <Stack gap="2">
                <Heading as="h1" size="lg">
                  {title}
                </Heading>
                <Text tone="muted">{description}</Text>
              </Stack>
              {children}
            </Stack>
          </Panel>
        </Box>
      </Container>
    </main>
  )
}
