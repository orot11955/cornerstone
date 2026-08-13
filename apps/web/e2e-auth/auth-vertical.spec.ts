import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

const email = 'admin@cornerstone.test'

test('protects SSR auth, refreshes once, and enforces CSRF through the same-origin API', async ({
  context,
  page,
}) => {
  const passwordFile = process.env.M6_E2E_PASSWORD_FILE
  if (!passwordFile) throw new Error('M6_E2E_PASSWORD_FILE is required')
  const password = await readFile(passwordFile, 'utf8')

  await page.goto('/settings/security')
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fsecurity$/)

  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호').fill(password)
  await page.getByRole('button', { name: '로그인' }).click()
  await expect(page).toHaveURL('/settings/security')
  await expect(page.getByRole('heading', { name: '보안 설정' })).toBeVisible()
  await expect(page.getByText(email)).toBeVisible()
  await expect(page.getByRole('heading', { name: '활성 세션' })).toBeVisible()

  const csrfStatus = await page.evaluate(async () => {
    const response = await fetch('/api/v1/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    return response.status
  })
  expect(csrfStatus).toBe(403)

  await context.clearCookies({ name: 'cs_access' })
  await page.goto('/settings/security')
  await expect(page).toHaveURL('/settings/security')
  await expect(page.getByText(email)).toBeVisible()

  await page.goto('/login?next=https%3A%2F%2Fevil.example')
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호').fill(password)
  await page.getByRole('button', { name: '로그인' }).click()
  await expect(page).toHaveURL('/')
})
