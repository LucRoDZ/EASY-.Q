import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthRedirect from './AuthRedirect';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue('mock-token') }),
}));

vi.mock('../api', () => ({
  api: {
    getDashboardMenus: vi.fn(),
  },
}));

import { api } from '../api';

describe('AuthRedirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('navigates to /onboarding when menus list is empty', async () => {
    api.getDashboardMenus.mockResolvedValue({ menus: [] });

    render(
      <MemoryRouter>
        <AuthRedirect />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding', { replace: true });
    });
  });

  it('navigates to /dashboard when menus list has entries', async () => {
    api.getDashboardMenus.mockResolvedValue({ menus: [{ id: 1 }] });

    render(
      <MemoryRouter>
        <AuthRedirect />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
    });
  });
});
