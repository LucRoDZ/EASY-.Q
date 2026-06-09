import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthRedirect from './AuthRedirect';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue('mock-token') }),
}));

vi.mock('../api', () => ({
  api: {
    getCurrentUser: vi.fn(),
    getDashboardMenus: vi.fn(),
  },
}));

import { api } from '../api';

describe('AuthRedirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('owner', () => {
    it('navigates to /onboarding when owner has no menus', async () => {
      api.getCurrentUser.mockResolvedValue({ role: 'owner' });
      api.getDashboardMenus.mockResolvedValue({ menus: [] });

      render(<MemoryRouter><AuthRedirect /></MemoryRouter>);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/onboarding', { replace: true });
      });
    });

    it('navigates to /dashboard when owner has menus', async () => {
      api.getCurrentUser.mockResolvedValue({ role: 'owner' });
      api.getDashboardMenus.mockResolvedValue({ menus: [{ id: 1 }] });

      render(<MemoryRouter><AuthRedirect /></MemoryRouter>);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
      });
    });
  });

  describe('waiter', () => {
    it('navigates to /waiter', async () => {
      api.getCurrentUser.mockResolvedValue({ role: 'waiter' });

      render(<MemoryRouter><AuthRedirect /></MemoryRouter>);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/waiter', { replace: true });
      });
      expect(api.getDashboardMenus).not.toHaveBeenCalled();
    });
  });

  describe('client', () => {
    it('navigates to /account when role is null', async () => {
      api.getCurrentUser.mockResolvedValue({ role: null });

      render(<MemoryRouter><AuthRedirect /></MemoryRouter>);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/account', { replace: true });
      });
      expect(api.getDashboardMenus).not.toHaveBeenCalled();
    });

    it('navigates to /account when role is "client"', async () => {
      api.getCurrentUser.mockResolvedValue({ role: 'client' });

      render(<MemoryRouter><AuthRedirect /></MemoryRouter>);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/account', { replace: true });
      });
    });

    it('navigates to /account on API error', async () => {
      api.getCurrentUser.mockRejectedValue(new Error('network error'));

      render(<MemoryRouter><AuthRedirect /></MemoryRouter>);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/account', { replace: true });
      });
    });
  });
});
