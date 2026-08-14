'use client'

import { useState } from 'react'
import { Button, Inline, Stack, Text } from '@cornerstone/ui'
import { Drawer, Menu, Popover, Tabs, Toast, Tooltip } from '@cornerstone/ui/browser'

export function InteractionShowcase() {
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <Stack gap="4" aria-label="Browser component fixture">
      <Tabs.Root defaultValue="overview">
        <Tabs.List aria-label="Dashboard views">
          <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
          <Tabs.Trigger value="activity">Activity</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="overview">Overview fixture</Tabs.Content>
        <Tabs.Content value="activity">Activity fixture</Tabs.Content>
      </Tabs.Root>

      <Inline gap="3" wrap>
        <Menu.Root>
          <Menu.Trigger>Actions</Menu.Trigger>
          <Menu.Content aria-label="Dashboard actions">
            <Menu.Item onClick={() => setNotice('Action completed')}>Run action</Menu.Item>
            <Menu.Item disabled>Unavailable action</Menu.Item>
          </Menu.Content>
        </Menu.Root>

        <Popover.Root>
          <Popover.Trigger>Details</Popover.Trigger>
          <Popover.Content aria-label="Dashboard details">
            <Stack gap="2">
              <Text>Popover fixture content</Text>
              <Popover.Close>Close details</Popover.Close>
            </Stack>
          </Popover.Content>
        </Popover.Root>

        <Tooltip.Root>
          <Tooltip.Trigger>Help</Tooltip.Trigger>
          <Tooltip.Content>Keyboard-accessible help</Tooltip.Content>
        </Tooltip.Root>

        <Drawer.Root>
          <Drawer.Trigger>Open drawer</Drawer.Trigger>
          <Drawer.Content side="end">
            <Drawer.Title>Fixture drawer</Drawer.Title>
            <Drawer.Description>Focus and dismissal reference.</Drawer.Description>
            <Drawer.Close>Close drawer</Drawer.Close>
          </Drawer.Content>
        </Drawer.Root>

        <Button type="button" variant="outline" onClick={() => setNotice('Saved locally')}>
          Show notification
        </Button>
      </Inline>

      <Toast.Viewport>
        {notice ? <Toast.Root title={notice} tone="success" /> : null}
      </Toast.Viewport>
    </Stack>
  )
}
