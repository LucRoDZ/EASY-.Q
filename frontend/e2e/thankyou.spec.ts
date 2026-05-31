import { test, expect } from '@playwright/test';

// ThankYouPage is shown after a successful Stripe payment redirect.
// It receives payment_intent and order_id in the URL.
test.describe('ThankYouPage', () => {
  const BASE_URL = '/thank-you?payment_intent=pi_test123&payment_intent_client_secret=pi_test123_secret&redirect_status=succeeded&order_id=ord-abc&slug=le-bistrot';

  test.beforeEach(async ({ page }) => {
    // Stripe retrieve PaymentIntent call (made server-side or via our API)
    await page.route('**/api/v1/payments/confirm**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'succeeded', order_id: 'ord-abc', pickup_number: null }),
      })
    );

    // NPS submit stub
    await page.route('**/api/v1/nps**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    );
  });

  test('renders thank you message', async ({ page }) => {
    await page.goto(BASE_URL);

    // Should show some success / merci message
    await expect(
      page.getByText(/merci|thank you|commande confirmée|order confirmed/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('NPS rating buttons are present', async ({ page }) => {
    await page.goto(BASE_URL);

    // NPS 1-10 stars or emoji — check for at least one rating button
    await expect(
      page.getByRole('button', { name: /1|2|3|4|5|6|7|8|9|10|⭐|😍|😊/i }).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
