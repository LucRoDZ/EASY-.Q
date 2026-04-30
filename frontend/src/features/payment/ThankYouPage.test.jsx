import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// ─── Mock lucide-react ────────────────────────────────────────────────────────
vi.mock('lucide-react', () => ({
  CheckCircle: ({ size }) => <span data-testid="icon-check" />,
  XCircle: ({ size }) => <span data-testid="icon-x" />,
  ChevronRight: () => <span />,
  Home: () => <span />,
  UtensilsCrossed: () => <span />,
  Download: () => <span />,
}));

// ─── Mock api ─────────────────────────────────────────────────────────────────
const mockSubmitFeedback = vi.fn();
vi.mock('../../api', () => ({
  api: {
    submitFeedback: (...args) => mockSubmitFeedback(...args),
  },
}));

// ─── Mock global fetch ────────────────────────────────────────────────────────
const mockFetch = vi.fn();
global.fetch = mockFetch;

import ThankYouPage from './ThankYouPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderThankYou(searchStr = '?redirect_status=succeeded&lang=fr') {
  return render(
    <MemoryRouter initialEntries={[`/menu/le-bistrot/thankyou${searchStr}`]}>
      <Routes>
        <Route path="/menu/:slug/thankyou" element={<ThankYouPage />} />
        <Route path="/menu/:slug/checkout" element={<div data-testid="checkout-page" />} />
        <Route path="/menu/:slug" element={<div data-testid="menu-page" />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve(null) });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ThankYouPage — success state', () => {
  it('shows success title in French when redirect_status=succeeded', async () => {
    renderThankYou('?redirect_status=succeeded&lang=fr');
    expect(screen.getByText('Paiement confirmé !')).toBeTruthy();
  });

  it('shows success title in English', async () => {
    renderThankYou('?redirect_status=succeeded&lang=en');
    expect(screen.getByText('Payment confirmed!')).toBeTruthy();
  });

  it('shows success icon (CheckCircle)', async () => {
    renderThankYou('?redirect_status=succeeded&lang=fr');
    expect(screen.getByTestId('icon-check')).toBeTruthy();
  });

  it('shows NPS survey on success', async () => {
    renderThankYou('?redirect_status=succeeded&lang=fr');
    // NPS survey shows score buttons 1–10
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
  });
});

describe('ThankYouPage — error state', () => {
  it('shows error title when redirect_status=failed', async () => {
    renderThankYou('?redirect_status=failed&lang=fr');
    expect(screen.getByText('Paiement non abouti')).toBeTruthy();
  });

  it('shows error title in English', async () => {
    renderThankYou('?redirect_status=failed&lang=en');
    expect(screen.getByText('Payment failed')).toBeTruthy();
  });

  it('shows error icon (XCircle)', async () => {
    renderThankYou('?redirect_status=failed&lang=fr');
    expect(screen.getByTestId('icon-x')).toBeTruthy();
  });

  it('does NOT show NPS survey on error', async () => {
    renderThankYou('?redirect_status=failed&lang=fr');
    // Score buttons shouldn't be visible
    expect(screen.queryByText('Comment évaluez-vous votre expérience ?')).toBeNull();
  });

  it('shows "Réessayer" link on error', async () => {
    renderThankYou('?redirect_status=failed&lang=fr');
    expect(screen.getByText('Réessayer')).toBeTruthy();
  });
});

describe('ThankYouPage — NPS survey submission', () => {
  it('renders the NPS question', async () => {
    renderThankYou('?redirect_status=succeeded&lang=fr');
    expect(screen.getByText('Comment évaluez-vous votre expérience ?')).toBeTruthy();
  });

  it('submit button is disabled when no score selected', async () => {
    renderThankYou('?redirect_status=succeeded&lang=fr');
    const submitBtn = screen.getByText('Envoyer');
    expect(submitBtn.disabled).toBe(true);
  });

  it('clicking a score enables the submit button', async () => {
    renderThankYou('?redirect_status=succeeded&lang=fr');
    const scoreBtn = screen.getAllByRole('button').find((b) => b.textContent === '8');
    fireEvent.click(scoreBtn);
    const submitBtn = screen.getByText('Envoyer');
    expect(submitBtn.disabled).toBe(false);
  });

  it('submitting the survey calls api.submitFeedback', async () => {
    mockSubmitFeedback.mockResolvedValueOnce({});
    renderThankYou('?redirect_status=succeeded&lang=fr&payment_intent=pi_test');

    const scoreBtn = screen.getAllByRole('button').find((b) => b.textContent === '9');
    fireEvent.click(scoreBtn);

    const submitBtn = screen.getByText('Envoyer');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSubmitFeedback).toHaveBeenCalledOnce();
    });
    const args = mockSubmitFeedback.mock.calls[0][0];
    expect(args.nps_score).toBe(9);
    expect(args.slug).toBe('le-bistrot');
    expect(args.payment_intent_id).toBe('pi_test');
  });

  it('shows thank you message after submission', async () => {
    mockSubmitFeedback.mockResolvedValueOnce({});
    renderThankYou('?redirect_status=succeeded&lang=fr');

    const scoreBtn = screen.getAllByRole('button').find((b) => b.textContent === '7');
    fireEvent.click(scoreBtn);
    fireEvent.click(screen.getByText('Envoyer'));

    await waitFor(() => {
      expect(screen.getByText('Merci pour votre retour !')).toBeTruthy();
    });
  });

  it('shows Google review link for high score when googlePlaceId is available', async () => {
    mockFetch.mockImplementationOnce((url) => {
      if (url.includes('/api/v1/restaurants/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ google_place_id: 'ChIJtest123' }),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });
    mockSubmitFeedback.mockResolvedValueOnce({});

    renderThankYou('?redirect_status=succeeded&lang=fr');

    await waitFor(() => {
      // fetch for google_place_id has been called
      expect(mockFetch).toHaveBeenCalled();
    });

    const scoreBtn = screen.getAllByRole('button').find((b) => b.textContent === '9');
    fireEvent.click(scoreBtn);
    fireEvent.click(screen.getByText('Envoyer'));

    await waitFor(() => {
      expect(screen.getByText('Laisser un avis Google')).toBeTruthy();
    });
  });

  it('api failure on submit still shows thank you (best-effort)', async () => {
    mockSubmitFeedback.mockRejectedValueOnce(new Error('Network error'));
    renderThankYou('?redirect_status=succeeded&lang=fr');

    const scoreBtn = screen.getAllByRole('button').find((b) => b.textContent === '6');
    fireEvent.click(scoreBtn);
    fireEvent.click(screen.getByText('Envoyer'));

    await waitFor(() => {
      expect(screen.getByText('Merci pour votre retour !')).toBeTruthy();
    });
  });
});

describe('ThankYouPage — navigation', () => {
  it('shows "Retour au menu" link', async () => {
    renderThankYou('?redirect_status=succeeded&lang=fr');
    expect(screen.getByText('Retour au menu')).toBeTruthy();
  });

  it('shows receipt download link when payment_intent is present', async () => {
    renderThankYou('?redirect_status=succeeded&lang=fr&payment_intent=pi_abc');
    expect(screen.getByText('Télécharger le reçu')).toBeTruthy();
  });
});
