import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import WaiterPage from './WaiterPage';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue('tok') }),
  useUser: () => ({ user: { firstName: 'Alice' } }),
}));

vi.mock('../../context/UserRoleContext', () => ({
  useUserRole: vi.fn(),
}));

vi.mock('../../api', () => ({
  api: { listTables: vi.fn() },
}));

import { useUserRole } from '../../context/UserRoleContext';
import { api } from '../../api';

const TABLES = [
  { id: 1, number: '1', label: 'Salle', capacity: 4, status: 'available', qr_token: 'tok-1' },
  { id: 2, number: '2', label: 'Terrasse', capacity: 2, status: 'occupied', qr_token: 'tok-2' },
];

function renderPage() {
  return render(<MemoryRouter><WaiterPage /></MemoryRouter>);
}

describe('WaiterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows error when no menuSlug in role context', async () => {
    useUserRole.mockReturnValue({ menuSlug: null });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/aucun restaurant associé/i)).toBeInTheDocument();
    });
  });

  it('shows tables from API', async () => {
    useUserRole.mockReturnValue({ menuSlug: 'le-bistrot' });
    api.listTables.mockResolvedValue({ tables: TABLES });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });
    expect(screen.getByText('Disponible')).toBeInTheDocument();
    expect(screen.getByText('Occupée')).toBeInTheDocument();
  });

  it('navigates to menu+table on click', async () => {
    useUserRole.mockReturnValue({ menuSlug: 'le-bistrot' });
    api.listTables.mockResolvedValue({ tables: TABLES });

    renderPage();

    await waitFor(() => screen.getByText('1'));

    await userEvent.click(screen.getAllByRole('button')[0]);

    expect(mockNavigate).toHaveBeenCalledWith('/menu/le-bistrot?table=tok-1');
  });

  it('shows error when API fails', async () => {
    useUserRole.mockReturnValue({ menuSlug: 'le-bistrot' });
    api.listTables.mockRejectedValue(new Error('network'));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/impossible de charger les tables/i)).toBeInTheDocument();
    });
  });

  it('shows empty state when no tables', async () => {
    useUserRole.mockReturnValue({ menuSlug: 'le-bistrot' });
    api.listTables.mockResolvedValue({ tables: [] });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/aucune table configurée/i)).toBeInTheDocument();
    });
  });
});
