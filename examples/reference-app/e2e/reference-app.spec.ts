import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const routes = [
  ['/login', 'ready'],
  ['/settings/profile', 'dirty'],
  ['/examples/resources', 'ready'],
  ['/dashboard', 'ready'],
] as const

test('reference routes preserve landmarks, keyboard access, axe and narrow reflow', async ({
  page,
}) => {
  for (const [route, state] of routes) {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto(`${route}?state=${state}`)
    await expect(page.locator(`[data-fixture-route="${route}"]`)).toHaveAttribute(
      'data-fixture-state',
      state,
    )
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  }

  await page.goto('/dashboard')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('main')).toBeFocused()
})

test('deterministic resource states are selectable with fixture links', async ({ page }) => {
  await page.goto('/examples/resources?state=loading')
  await expect(page.getByLabel('Loading table')).toBeVisible()
  await page.getByRole('link', { name: 'empty' }).click()
  await expect(page.locator('[data-fixture-state="empty"]')).toBeVisible()
  await expect(page.getByText('리소스가 없습니다')).toBeVisible()
})

test('dashboard browser components preserve keyboard, focus, placement and announcements', async ({
  page,
}) => {
  await page.goto('/dashboard')

  await page.getByRole('tab', { name: 'Activity' }).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Activity' })).toBeFocused()
  await expect(page.getByRole('tabpanel', { name: 'Activity' })).toContainText('Activity fixture')

  const menuTrigger = page.getByRole('button', { name: 'Actions' })
  await menuTrigger.click()
  const menu = page.getByRole('menu', { name: 'Dashboard actions' })
  await expect(menu).toBeVisible()
  const [triggerBox, menuBox] = await Promise.all([menuTrigger.boundingBox(), menu.boundingBox()])
  expect(triggerBox).not.toBeNull()
  expect(menuBox).not.toBeNull()
  expect(Math.abs((menuBox?.x ?? 0) - (triggerBox?.x ?? 0))).toBeLessThan(40)
  await page.getByRole('menuitem', { name: 'Run action' }).click()
  await expect(page.getByRole('status')).toContainText('Action completed')
  await expect(menuTrigger).toBeFocused()

  const detailsTrigger = page.getByRole('button', { name: 'Details' })
  await detailsTrigger.click()
  await expect(page.getByText('Popover fixture content')).toBeVisible()
  await page.getByRole('button', { name: 'Close details' }).click()
  await expect(detailsTrigger).toBeFocused()

  const tooltipTrigger = page.getByRole('button', { name: 'Help' })
  await tooltipTrigger.focus()
  await expect(page.getByRole('tooltip')).toHaveText('Keyboard-accessible help')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toBeHidden()

  const drawerTrigger = page.getByRole('button', { name: 'Open drawer' })
  await drawerTrigger.click()
  const drawer = page.getByRole('dialog', { name: 'Fixture drawer' })
  await expect(drawer).toBeVisible()
  await page.getByRole('button', { name: 'Close drawer' }).click()
  await expect(drawerTrigger).toBeFocused()

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})
