import { Box, Container, Heading, Stack, Text } from '@cornerstone/ui'
import { requireAuthenticatedUser } from '../../../auth/server'
import { SecurityClient } from './security-client'

export default async function SecurityPage() {
  const user = await requireAuthenticatedUser('/settings/security')
  return (
    <main>
      <Container size="md" gutter="4">
        <Box padding={{ base: '6', md: '10' }}>
          <Stack gap="6">
            <Stack gap="1">
              <Heading as="h1" size="lg">
                보안 설정
              </Heading>
              <Text tone="muted">{user.email}</Text>
            </Stack>
            <SecurityClient />
          </Stack>
        </Box>
      </Container>
    </main>
  )
}
