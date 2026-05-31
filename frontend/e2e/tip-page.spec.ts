import { test, expect } from '@playwright/test';

// TipPage receives amount in cents via URL and lets the user pick a tip preset
// before forwarding to the Stripe checkout page.
test.describe('TipPage', () => {
  const BASE_URL = '/tip?slug=le-bistrot&table=tbl-abc&amount=2000&currency=EUR';

  test('renders tip preset buttons', async ({ page }) => {
    await page.goto(BASE_URL);

    // Presets: 0%, 5%, 10%, 15%
    await expect(page.getByText('0%')).toBeVisible();
    await expect(page.getByText('10%')).toBeVisible();
    await expect(page.getByText('15%')).toBeVisible();
  });

  test('base amount is shown', async ({ page }) => {
    await page.goto(BASE_URL);

    // 20.00 € base (2000 cents)
    await expect(page.getByText(/20[.,]00/)).toBeVisible();
  });

  test('selecting 10% tip updates the total', async ({ page }) => {
    await page.goto(BASE_URL);

    await page.getByText('10%').click();

    // Total should be 20.00 + 2.00 = 22.00
    await expect(page.getByText(/22[.,]00/)).toBeVisible();
  });

  test('continue button navigates toward checkout', async ({ page }) => {
    await page.goto(BASE_URL);

    // Stub Stripe checkout page so we don't actually navigate to Stripe
    await page.route('**/create-payment-intent**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ client_secret: 'pi_test_secret', order_id: 'ord-1' }) })
    );

    const continueBtn = page.getByRole('button', { name: /continuer|continue|payer/i });
    await expect(continueBtn).toBeVisible();
  });
});
