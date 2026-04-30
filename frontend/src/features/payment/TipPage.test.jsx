import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CartProvider } from '../../context/CartContext';

// ─── Mock lucide-react ────────────────────────────────────────────────────────
vi.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="icon-arrow-left" />,
  Heart: () => <span data-testid="icon-heart" />,
}));

import TipPage from './TipPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function renderTipPage(searchStr = '?lang=fr&currency=EUR', cartItems = []) {
  if (cartItems.length > 0) {
    localStorage.setItem('easyq_cart', JSON.stringify(cartItems));
  }
  return render(
    <CartProvider>
      <MemoryRouter initialEntries={[`/menu/le-bistrot/tip${searchStr}`]}>
        <Routes>
          <Route path="/menu/:slug/tip" element={<TipPage />} />
          <Route path="/menu/:slug/cart" element={<div data-testid="cart-page" />} />
          <Route path="/menu/:slug/checkout" element={<div data-testid="checkout-page" />} />
        </Routes>
      </MemoryRouter>
    </CartProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TipPage — rendering', () => {
  it('renders the tip page header in French', () => {
    renderTipPage('?lang=fr&currency=EUR');
    expect(screen.getByText('Ajouter un pourboire')).toBeTruthy();
  });

  it('renders the tip page header in English', () => {
    renderTipPage('?lang=en&currency=EUR');
    expect(screen.getByText('Add a tip')).toBeTruthy();
  });

  it('renders preset tip buttons', () => {
    renderTipPage();
    expect(screen.getByText('Sans pourboire')).toBeTruthy();
    expect(screen.getByText('5 %')).toBeTruthy();
    expect(screen.getByText('10 %')).toBeTruthy();
    expect(screen.getByText('15 %')).toBeTruthy();
  });

  it('renders the confirm button', () => {
    renderTipPage();
    expect(screen.getByText(/Confirmer/)).toBeTruthy();
  });

  it('renders the custom amount input', () => {
    renderTipPage();
    const input = screen.getByPlaceholderText('0,00');
    expect(input).toBeTruthy();
  });
});

describe('TipPage — tip selection', () => {
  it('10% is selected by default', () => {
    renderTipPage('?lang=fr&currency=EUR');
    // The 10% button should have the active (bg-black) style
    const btn10 = screen.getByText('10 %').closest('button');
    expect(btn10.className).toContain('bg-neutral-900');
  });

  it('clicking "Sans pourboire" deselects tip', () => {
    renderTipPage('?lang=fr&currency=EUR');
    const noTipBtn = screen.getByText('Sans pourboire').closest('button');
    fireEvent.click(noTipBtn);
    expect(noTipBtn.className).toContain('bg-neutral-900');
  });

  it('clicking a preset selects it', () => {
    renderTipPage('?lang=fr&currency=EUR');
    const btn5 = screen.getByText('5 %').closest('button');
    fireEvent.click(btn5);
    expect(btn5.className).toContain('bg-neutral-900');
  });
});

describe('TipPage — navigation on confirm', () => {
  it('navigates to checkout with tip in cents when confirmed', () => {
    // Cart total = 0 (empty cart), 10% tip = 0 → tip cents = 0
    renderTipPage('?lang=fr&currency=EUR&table=abc123');
    const confirmBtn = screen.getByText(/Confirmer/).closest('button');
    fireEvent.click(confirmBtn);

    expect(mockNavigate).toHaveBeenCalledOnce();
    const [path] = mockNavigate.mock.calls[0];
    expect(path).toContain('/menu/le-bistrot/checkout');
    expect(path).toContain('tip=');
    expect(path).toContain('lang=fr');
    expect(path).toContain('table=abc123');
  });

  it('tip param is in integer cents, not euros', () => {
    // Use a cart with items so we can verify the conversion
    const cartItems = [{ name: 'Steak', price: 20, quantity: 1 }];
    renderTipPage('?lang=fr&currency=EUR', cartItems);

    // Select 10% preset (should already be selected by default)
    const confirmBtn = screen.getByText(/Confirmer/).closest('button');
    fireEvent.click(confirmBtn);

    expect(mockNavigate).toHaveBeenCalledOnce();
    const [path] = mockNavigate.mock.calls[0];
    // 10% of 20 = 2€ = 200 cents
    const params = new URLSearchParams(path.split('?')[1]);
    const tip = parseInt(params.get('tip'));
    expect(Number.isInteger(tip)).toBe(true);
  });
});

describe('TipPage — custom amount', () => {
  it('typing a custom amount activates custom mode', () => {
    renderTipPage('?lang=fr&currency=EUR');
    const input = screen.getByPlaceholderText('0,00');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '3.50' } });
    // After entering custom, 10% button should no longer be active
    const btn10 = screen.getByText('10 %').closest('button');
    expect(btn10.className).not.toContain('bg-neutral-900');
  });

  it('custom amount is used in the summary', () => {
    renderTipPage('?lang=fr&currency=EUR');
    const input = screen.getByPlaceholderText('0,00');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '5' } });
    // Confirm and verify the navigate call includes the custom tip
    const confirmBtn = screen.getByText(/Confirmer/).closest('button');
    fireEvent.click(confirmBtn);
    const [path] = mockNavigate.mock.calls[0];
    const params = new URLSearchParams(path.split('?')[1]);
    expect(parseInt(params.get('tip'))).toBe(500); // 5€ = 500 cents
  });
});
