import { test, expect } from 'playwright/test'

/**
 * Smoke: the callback form is the entire revenue surface.
 * We mock `/api/callback` so this test NEVER writes to prod MongoDB.
 * Happy-path only: fill required fields, submit, assert success state.
 */
test('callback form happy path shows success state', async ({ page }) => {
  // Capture the request so we can also validate the payload we're sending.
  let captured: { method: string; body: unknown } | null = null

  await page.route('**/api/callback', async (route) => {
    const request = route.request()
    let parsedBody: unknown = null
    try {
      parsedBody = request.postDataJSON()
    } catch {
      parsedBody = request.postData()
    }
    captured = { method: request.method(), body: parsedBody }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })

  await page.goto('/')

  // The form lives in the DecisionPathSection (#submit). Scroll into view
  // so reveal animations don't intercept clicks.
  const form = page.locator('form.decision-form')
  await form.scrollIntoViewIfNeeded()
  await expect(form).toBeVisible()

  await form.locator('input[name="email"]').fill('qa-bot@vedryx.test')
  await form.locator('input[name="phone"]').fill('+919999999999')
  await form.locator('input[name="company"]').fill('Vedryx QA Bot')
  // Role is a select with a default; explicitly pick the first option to be safe.
  const role = form.locator('select[name="role"]')
  const firstRole = await role.locator('option').first().getAttribute('value')
  if (firstRole) await role.selectOption(firstRole)
  await form
    .locator('textarea[name="summary"]')
    .fill('Senior React engineer, 4+ years, immediate start, must own dashboard delivery end-to-end.')

  await form.locator('button[type="submit"]').click()

  // Success state: inline status message AND modal dialog both render.
  await expect(page.getByRole('status')).toContainText('Requirement received')
  await expect(page.getByRole('dialog', { name: /Vedryx will contact you shortly\./i })).toBeVisible()

  // Sanity: request was actually fired with the right shape.
  expect(captured, 'POST /api/callback was never called').not.toBeNull()
  expect(captured!.method).toBe('POST')
  const body = captured!.body as Record<string, string>
  expect(body.email).toBe('qa-bot@vedryx.test')
  expect(body.phone).toBe('+919999999999')
  expect(body.summary).toContain('Senior React engineer')
})
