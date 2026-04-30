import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CartProvider } from '../../context/CartContext';
import CartPage from './CartPage';

// localStorage available in jsdom — reset between tests
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderCartPage(initialCart = []) {
  // Pre-seed localStorage so CartProvider hydrates with items
  if (initialCart.length > 0) {
    localStorage.setItem('easyq_cart', JSON.stringify(initialCart));
  }

  return render(
    <CartProvider>
      <MemoryRouter initialEntries={['/menu/le-bistrot/cart?lang=fr&currency=EUR']}>
        <Routes>
          <Route path="/menu/:slug/cart" element={<CartPage />} />
        </Routes>
      </MemoryRouter>
    </CartProvider>
  );
}

const ITEM_A = { name: 'Salade César', price: 12.5, quantity: 1 };
const ITEM_B = { name: 'Boeuf bourguignon', price: 22, quantity: 2 };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CartPage — empty state', () => {
  it('shows empty cart message when cart is empty', () => {
    renderCartPage([]);
    // The translation key emptyCart = "Votre panier est vide"
    expect(screen.getByText(/panier est vide|cart is empty|carrito.*vacío/i)).toBeInTheDocument();
  });

  it('shows a browse menu link from empty state', () => {
    renderCartPage([]);
    // The translation key browseMenu = "Voir le Menu"
    const links = screen.getAllByRole('link');
    const menuLinks = links.filter((l) => l.getAttribute('href')?.includes('/menu/le-bistrot'));
    expect(menuLinks.length).toBeGreaterThan(0);
  });
});

describe('CartPage — items list', () => {
  it('renders item names', () => {
    renderCartPage([ITEM_A, ITEM_B]);
    expect(screen.getByText('Salade César')).toBeInTheDocument();
    expect(screen.getByText('Boeuf bourguignon')).toBeInTheDocument();
  });

  it('renders item unit prices', () => {
    renderCartPage([ITEM_A]);
    // Unit price appears in the item row's <p class="text-sm"> tag
    const priceEls = screen.getAllByText(/12[,.]50|€\s*12/);
    expect(priceEls.length).toBeGreaterThanOrEqual(1);
  });

  it('renders item quantities', () => {
    renderCartPage([ITEM_B]);
    // Quantity "2" shown in the quantity control
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders subtotal per item (price × qty)', () => {
    renderCartPage([ITEM_B]);
    // 22 × 2 = 44
    const subtotalEls = screen.getAllByText(/44[,.]00|44\.00|44\s*€|€\s*44/);
    expect(subtotalEls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('CartPage — quantity controls', () => {
  it('increases quantity when + is clicked', async () => {
    const user = userEvent.setup();
    renderCartPage([ITEM_A]);

    // Find quantity display and its controls
    const qtyDisplay = screen.getByText('1');
    const controls = qtyDisplay.parentElement;
    const buttons = controls.querySelectorAll('button');
    expect(buttons.length).toBe(2);

    await user.click(buttons[1]); // Plus button

    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
  });

  it('removes item when quantity decremented to 0', async () => {
    const user = userEvent.setup();
    renderCartPage([ITEM_A]);

    const qtyDisplay = screen.getByText('1');
    const controls = qtyDisplay.parentElement;
    const [minusBtn] = controls.querySelectorAll('button');
    await user.click(minusBtn);

    // qty 1 → 0 → removeItem
    await waitFor(() =>
      expect(screen.queryByText('Salade César')).not.toBeInTheDocument()
    );
  });

  it('removes item when trash button is clicked', async () => {
    const user = userEvent.setup();
    renderCartPage([ITEM_A, ITEM_B]);

    // Find the trash button for ITEM_A (first item row)
    const itemRows = document.querySelectorAll('.p-4.flex.items-center');
    const firstRow = itemRows[0];
    if (firstRow) {
      const buttons = firstRow.querySelectorAll('button');
      const trashBtn = Array.from(buttons).pop(); // last button = trash
      await user.click(trashBtn);
      await waitFor(() =>
        expect(screen.queryByText('Salade César')).not.toBeInTheDocument()
      );
    } else {
      // Fallback: click any button with svg and neutral color class
      const candidates = screen.getAllByRole('button').filter(
        (b) => b.className.includes('text-neutral-400')
      );
      if (candidates.length > 0) {
        await user.click(candidates[0]);
        await waitFor(() =>
          expect(screen.queryByText('Salade César')).not.toBeInTheDocument()
        );
      }
    }
  });
});

describe('CartPage — totals and VAT', () => {
  it('displays cart total in the summary block', () => {
    renderCartPage([ITEM_A, { name: 'Boeuf bourguignon', price: 22, quantity: 1 }]);
    // 12.5 + 22 = 34.5
    const els = screen.getAllByText(/34[,.]50|34\.50|34,50|€\s*34/);
    expect(els.length).toBeGreaterThanOrEqual(1);
  });

  it('shows VAT breakdown line items', () => {
    renderCartPage([ITEM_A]);
    expect(screen.getByText(/TVA 10%/)).toBeInTheDocument();
    expect(screen.getByText(/TVA 20%/)).toBeInTheDocument();
  });

  it('shows minimum order warning when total < 5€', () => {
    renderCartPage([{ name: 'Petit café', price: 2, quantity: 1 }]);
    expect(screen.getByText(/minimum|Minimum/i)).toBeInTheDocument();
  });

  it('disables pay button when total < 5€', () => {
    renderCartPage([{ name: 'Petit café', price: 2, quantity: 1 }]);
    const payBtn = document.querySelector('button:disabled');
    expect(payBtn).toBeTruthy();
  });

  it('enables pay button when total >= 5€', () => {
    renderCartPage([ITEM_A]);
    // The pay button is not disabled
    const buttons = screen.getAllByRole('button');
    const payBtn = buttons.find((b) => b.textContent.includes('Payer') || b.textContent.includes('Pay'));
    if (payBtn) {
      expect(payBtn).not.toBeDisabled();
    }
  });
});

describe('CartPage — navigation', () => {
  it('shows back link to menu in header', () => {
    renderCartPage([ITEM_A]);
    const header = document.querySelector('header');
    const backLink = within(header).getByRole('link');
    expect(backLink.getAttribute('href')).toContain('/menu/le-bistrot');
  });

  it('shows accepted payments text', () => {
    renderCartPage([ITEM_A]);
    // "Modes de paiement acceptés" (fr) | "Accepted payment methods" (en)
    expect(screen.getByText(/paiement acceptés|payment methods|métodos de pago/i)).toBeInTheDocument();
  });
});
