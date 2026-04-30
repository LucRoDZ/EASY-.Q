import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CartProvider } from '../../context/CartContext';

// ─── Mock heavy dependencies ──────────────────────────────────────────────────

// Stripe: loadStripe + Elements + PaymentElement
vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }) => <div data-testid="stripe-elements">{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmPayment: vi.fn() }),
  useElements: () => ({}),
}));

// api module
vi.mock('../../api', () => ({
  api: {
    getStripeConfig: vi.fn(),
    createPaymentIntent: vi.fn(),
  },
}));

import { api } from '../../api';
import CheckoutPage from './CheckoutPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderCheckout(cartItems = [], searchStr = '?lang=fr&currency=EUR') {
  if (cartItems.length > 0) {
    localStorage.setItem('easyq_cart', JSON.stringify(cartItems));
  }
  return render(
    <CartProvider>
      <MemoryRouter initialEntries={[`/menu/le-bistrot/checkout${searchStr}`]}>
        <Routes>
          <Route path="/menu/:slug/checkout" element={<CheckoutPage />} />
          <Route path="/menu/:slug/cart" element={<div data-testid="cart-page" />} />
        </Routes>
      </MemoryRouter>
    </CartProvider>
  );
}

const ITEM = { name: 'Boeuf bourguignon', price: 22, quantity: 1 };

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CheckoutPage — empty cart redirect', () => {
  it('redirects to cart page when cart is empty', async () => {
    renderCheckout([]); // no items
    await waitFor(() => {
      expect(screen.getByTestId('cart-page')).toBeInTheDocument();
    });
  });
});

describe('CheckoutPage — loading state', () => {
  it('shows loading spinner while initialising payment', () => {
    // api calls never resolve → stays in loading
    api.getStripeConfig.mockReturnValue(new Promise(() => {}));

    renderCheckout([ITEM]);
    // Spinner text OR aria
    expect(
      screen.getByText(/initialisation|Initialisation/i) ||
      document.querySelector('.animate-spin')
    ).toBeTruthy();
  });
});

describe('CheckoutPage — error state', () => {
  it('shows error message when Stripe config fails', async () => {
    api.getStripeConfig.mockRejectedValue(new Error('Stripe non configuré'));

    renderCheckout([ITEM]);
    await waitFor(() => {
      expect(screen.getByText(/Stripe non configuré|Erreur/i)).toBeInTheDocument();
    });
  });

  it('shows retry button after failure', async () => {
    api.getStripeConfig.mockRejectedValue(new Error('Network error'));

    renderCheckout([ITEM]);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /réessayer|retry/i })).toBeInTheDocument();
    });
  });
});

describe('CheckoutPage — success state', () => {
  beforeEach(() => {
    api.getStripeConfig.mockResolvedValue({ publishable_key: 'pk_test_abc' });
    api.createPaymentIntent.mockResolvedValue({
      client_secret: 'pi_test_secret',
      payment_intent_id: 'pi_test_123',
      amount: 2200,
      currency: 'eur',
    });
  });

  it('renders the Stripe Elements wrapper after loading', async () => {
    renderCheckout([ITEM]);
    await waitFor(() => {
      expect(screen.getByTestId('stripe-elements')).toBeInTheDocument();
    });
  });

  it('renders the PaymentElement', async () => {
    renderCheckout([ITEM]);
    await waitFor(() => {
      expect(screen.getByTestId('payment-element')).toBeInTheDocument();
    });
  });

  it('shows item names in order summary', async () => {
    renderCheckout([ITEM]);
    await waitFor(() => {
      expect(screen.getByText('Boeuf bourguignon')).toBeInTheDocument();
    });
  });

  it('shows the page title', async () => {
    renderCheckout([ITEM]);
    expect(screen.getByRole('heading', { name: /paiement/i })).toBeInTheDocument();
  });

  it('shows back link to cart', async () => {
    renderCheckout([ITEM]);
    const links = screen.getAllByRole('link');
    const backLink = links.find((l) => l.getAttribute('href')?.includes('/cart'));
    expect(backLink).toBeTruthy();
  });

  it('calls createPaymentIntent with correct slug and items', async () => {
    renderCheckout([ITEM]);
    await waitFor(() => {
      expect(api.createPaymentIntent).toHaveBeenCalledWith(
        'le-bistrot',
        expect.arrayContaining([expect.objectContaining({ name: 'Boeuf bourguignon' })]),
        expect.any(Number), // tip
        'eur',
        null, // tableToken — no ?table= param in test URL
      );
    });
  });
});

describe('CheckoutPage — tip in summary', () => {
  beforeEach(() => {
    api.getStripeConfig.mockResolvedValue({ publishable_key: 'pk_test_abc' });
    api.createPaymentIntent.mockResolvedValue({
      client_secret: 'pi_test_secret',
      payment_intent_id: 'pi_test_123',
      amount: 2700, // 22 + 5 tip
      currency: 'eur',
    });
  });

  it('shows tip line when tip param is provided', async () => {
    renderCheckout([ITEM], '?lang=fr&currency=EUR&tip=500');
    await waitFor(() => {
      expect(screen.getByText(/pourboire/i)).toBeInTheDocument();
    });
  });
});
