import { test, expect } from '@playwright/test';

const SLUG = 'le-bistrot';
const TABLE = 'tbl-abc123';

const MENU_MOCK = {
  restaurant_name: 'Le Bistrot',
  slug: SLUG,
  currency: 'EUR',
  publish_status: 'published',
  sections: [
    {
      id: 'sec-1',
      title: 'Entrées',
      items: [
        {
          id: 'item-1',
          name: 'Salade César',
          description: 'Fraîche et croustillante',
          price: 12.5,
          allergens: ['gluten', 'lactose'],
          tags: ['maison'],
          is_available: true,
        },
        {
          id: 'item-2',
          name: 'Soupe du jour',
          description: '',
          price: 8.0,
          allergens: [],
          tags: [],
          is_available: true,
        },
      ],
    },
    {
      id: 'sec-2',
      title: 'Plats',
      items: [
        {
          id: 'item-3',
          name: 'Boeuf Bourguignon',
          description: 'Mijoté lentement',
          price: 22.0,
          allergens: [],
          tags: ['maison'],
          is_available: true,
        },
      ],
    },
  ],
  wines: [],
};

test.beforeEach(async ({ page }) => {
  // Intercept the public menu API call
  await page.route(`**/api/public/menus/${SLUG}**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MENU_MOCK) })
  );

  // Stub Google rating (not required to render)
  await page.route(`**/api/v1/restaurants/${SLUG}/google-rating`, (route) =>
    route.fulfill({ status: 404 })
  );

  // Stub chat conversation init
  await page.route(`**/api/public/menus/${SLUG}/conversation**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) })
  );
});

test('public menu page renders restaurant name and sections', async ({ page }) => {
  await page.goto(`/menu/${SLUG}?table=${TABLE}`);

  await expect(page.getByText('Le Bistrot')).toBeVisible();
  await expect(page.getByText('Entrées')).toBeVisible();
  await expect(page.getByText('Plats')).toBeVisible();
});

test('menu items are visible with price', async ({ page }) => {
  await page.goto(`/menu/${SLUG}?table=${TABLE}`);

  await expect(page.getByText('Salade César')).toBeVisible();
  await expect(page.getByText('12.50 €')).toBeVisible();
  await expect(page.getByText('Boeuf Bourguignon')).toBeVisible();
  await expect(page.getByText('22.00 €')).toBeVisible();
});

test('adding an item to cart shows the cart summary bar', async ({ page }) => {
  await page.goto(`/menu/${SLUG}?table=${TABLE}`);

  // Click the first "+" add-to-cart button
  const addButtons = page.getByRole('button', { name: /ajouter|add|\+/i });
  await addButtons.first().click();

  // Cart summary bar should appear
  await expect(page.locator('[data-testid="cart-summary-bar"]').or(page.getByText(/voir le panier|view cart/i))).toBeVisible();
});

test('search filter narrows visible items', async ({ page }) => {
  await page.goto(`/menu/${SLUG}?table=${TABLE}`);

  const searchInput = page.getByPlaceholder(/recherche|search/i);
  await searchInput.fill('César');

  // Only Salade César should remain, Boeuf Bourguignon should be gone
  await expect(page.getByText('Salade César')).toBeVisible();
  await expect(page.getByText('Boeuf Bourguignon')).not.toBeVisible();
});
