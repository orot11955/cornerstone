import type { ReactNode } from 'react'
import { AppShell, Link, Sidebar, Stack, Text } from '@cornerstone/ui'

const navigation = [
  ['/dashboard', '대시보드'],
  ['/settings/profile', '프로필'],
  ['/examples/resources', '리소스'],
] as const

export function ReferenceShell({
  children,
  currentPath,
}: {
  readonly children: ReactNode
  readonly currentPath: string
}) {
  return (
    <AppShell
      header={
        <Text as="p" weight="semibold">
          Cornerstone reference
        </Text>
      }
      sidebar={
        <Sidebar label="Reference navigation">
          <Stack gap="3">
            {navigation.map(([href, label]) => (
              <Link key={href} href={href} current={href === currentPath}>
                {label}
              </Link>
            ))}
          </Stack>
        </Sidebar>
      }
    >
      {children}
    </AppShell>
  )
}
