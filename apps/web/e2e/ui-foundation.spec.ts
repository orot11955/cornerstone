import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('hydrates without errors and preserves responsive content', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/ui-foundation')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cornerstone UI Foundation')
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`ui-foundation-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    })
  }

  expect(errors.filter((message) => /hydration|uncaught|error/i.test(message))).toEqual([])
})

test('applies container breakpoints, RTL and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' })
  await page.goto('/ui-foundation')

  await expect(page.getByTestId('rtl-fixture')).toHaveAttribute('dir', 'rtl')
  for (const [width, columns] of [
    [280, 1],
    [480, 2],
    [720, 3],
    [960, 4],
  ] as const) {
    const value = await page
      .getByTestId(`container-grid-${width}`)
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
    expect(value).toBe(columns)
  }
  const animationDuration = await page
    .getByLabel('불러오는 중')
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).animationDuration))
  expect(animationDuration).toBeLessThanOrEqual(0.00001)
})

test('dialog has one state transition, restores focus and passes axe', async ({ page }) => {
  await page.goto('/ui-foundation')
  const trigger = page.getByTestId('dialog-trigger')
  const dialogId = await trigger.getAttribute('aria-controls')
  expect(dialogId).toBeTruthy()

  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '환경 설정' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('id', dialogId!)
  await expect(dialog).toHaveAttribute('aria-labelledby', 'settings-dialog-title')
  await expect(dialog).toHaveAttribute('aria-describedby', 'settings-dialog-description')
  await expect(page.getByTestId('dialog-input')).toBeFocused()
  expect((await new AxeBuilder({ page }).include('dialog').analyze()).violations).toEqual([])

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect(page.getByTestId('dialog-changes')).toHaveText('2')

  await trigger.click()
  await page.getByTestId('dialog-close').click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('dialog-changes')).toHaveText('4')

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})
