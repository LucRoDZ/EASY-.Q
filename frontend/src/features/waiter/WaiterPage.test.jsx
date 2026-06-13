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
  api: {
    getTablesSummary: vi.fn(),
    getWaiterCalls: vi.fn(),
    listOrdersByTable: vi.fn(),
    updateTable: vi.fn(),
    updateWaiterCallStatus: vi.fn(),
  },
}));

import { useUserRole } from '../../context/UserRoleContext';
import { api } from '../../api';

const TABLES = [
  {
    id: 1, number: 'T1', label: 'Salle', capacity: 4, status: 'available', qr_token: 'tok-1',
    pending_orders: 0, in_progress_orders: 0, ready_orders: 0, pending_calls: 0,
  },
  {
    id: 2, number: 'T2', label: 'Terrasse', capacity: 2, status: 'occupied', qr_token: 'tok-2',
    pending_orders: 1, in_progress_orders: 2, ready_orders: 4, pending_calls: 1,
  },
];

function renderPage() {
  return render(<MemoryRouter><WaiterPage /></MemoryRouter>);
}

describe('WaiterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getWaiterCalls.mockResolvedValue({ calls: [] });
    api.listOrdersByTable.mockResolvedValue([]);
  });

  it('shows error when no menuSlug in role context', async () => {
    useUserRole.mockReturnValue({ menuSlug: null });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/aucun restaurant associé/i)).toBeInTheDocument();
    });
  });

  it('shows tables from summary API', async () => {
    useUserRole.mockReturnValue({ menuSlug: 'le-bistrot' });
    api.getTablesSummary.mockResolvedValue({ tables: TABLES });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('T1')).toBeInTheDocument();
      expect(screen.getByText('T2')).toBeInTheDocument();
    });
    expect(screen.getByText('Disponible')).toBeInTheDocument();
    expect(screen.getByText('Occupée')).toBeInTheDocument();
  });

  it('opens detail panel on table click and navigates to order flow', async () => {
    useUserRole.mockReturnValue({ menuSlug: 'le-bistrot' });
    api.getTablesSummary.mockResolvedValue({ tables: TABLES });

    renderPage();

    await waitFor(() => screen.getByText('T1'));

    // Click table 1 → detail panel
    await userEvent.click(screen.getByText('T1'));
    await waitFor(() => {
      expect(screen.getByText('Commander pour cette table')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Commander pour cette table'));
    expect(mockNavigate).toHaveBeenCalledWith('/menu/le-bistrot?table=tok-1&tableNumber=T1');
  });

  it('closes a table from the detail panel', async () => {
    useUserRole.mockReturnValue({ menuSlug: 'le-bistrot' });
    api.getTablesSummary.mockResolvedValue({ tables: TABLES });
    api.updateTable.mockResolvedValue({});

    renderPage();

    await waitFor(() => screen.getByText('T2'));
    await userEvent.click(screen.getByText('T2'));
    await waitFor(() => screen.getByText('Clôturer la table'));

    await userEvent.click(screen.getByText('Clôturer la table'));

    await waitFor(() => {
      expect(api.updateTable).toHaveBeenCalledWith(2, { status: 'available' }, 'tok');
    });
  });

  it('shows pending waiter calls with acknowledge action', async () => {
    useUserRole.mockReturnValue({ menuSlug: 'le-bistrot' });
    api.getTablesSummary.mockResolvedValue({ tables: TABLES });
    api.getWaiterCalls.mockResolvedValue({
      calls: [
        {
          id: 'call-1', table_number: 'T2', message: 'Appel serveur',
          timestamp: new Date().toISOString(), status: 'pending',
        },
      ],
    });
    api.updateWaiterCallStatus.mockResolvedValue({});

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Prendre en charge')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Prendre en charge'));

    await waitFor(() => {
      expect(api.updateWaiterCallStatus).toHaveBeenCalledWith('le-bistrot', 'call-1', 'acknowledged', 'tok');
    });
  });

  it('shows error when API fails', async () => {
    useUserRole.mockReturnValue({ menuSlug: 'le-bistrot' });
    api.getTablesSummary.mockRejectedValue(new Error('network'));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/impossible de charger les tables/i)).toBeInTheDocument();
    });
  });

  it('shows empty state when no tables', async () => {
    useUserRole.mockReturnValue({ menuSlug: 'le-bistrot' });
    api.getTablesSummary.mockResolvedValue({ tables: [] });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/aucune table configurée/i)).toBeInTheDocument();
    });
  });
});
