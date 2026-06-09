import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequireOwner from './RequireOwner';

const mockNavigateTo = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    Navigate: ({ to }) => {
      mockNavigateTo(to);
      return <span data-testid="navigate" data-to={to} />;
    },
  };
});

vi.mock('@clerk/clerk-react', () => ({
  SignedIn: vi.fn(),
  SignedOut: vi.fn(),
}));

vi.mock('../context/UserRoleContext', () => ({
  useUserRole: vi.fn(),
}));

import { SignedIn, SignedOut } from '@clerk/clerk-react';
import { useUserRole } from '../context/UserRoleContext';

function renderOwner(children = <div>Dashboard</div>) {
  return render(<MemoryRouter><RequireOwner>{children}</RequireOwner></MemoryRouter>);
}

describe('RequireOwner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    SignedIn.mockImplementation(({ children }) => <>{children}</>);
    SignedOut.mockImplementation(() => null);
  });

  it('renders null while loading', () => {
    useUserRole.mockReturnValue({ role: null, loading: true });
    const { container } = renderOwner();
    expect(container.firstChild).toBeNull();
  });

  it('renders children for owner', () => {
    useUserRole.mockReturnValue({ role: 'owner', loading: false });
    renderOwner();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument();
  });

  it('redirects waiter to /waiter', () => {
    useUserRole.mockReturnValue({ role: 'waiter', loading: false });
    renderOwner();
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/waiter');
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('redirects client (null role) to /account', () => {
    useUserRole.mockReturnValue({ role: null, loading: false });
    renderOwner();
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/account');
  });

  it('redirects client ("client" role) to /account', () => {
    useUserRole.mockReturnValue({ role: 'client', loading: false });
    renderOwner();
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/account');
  });

  it('redirects signed-out user to / via SignedOut', () => {
    useUserRole.mockReturnValue({ role: 'owner', loading: false });
    SignedIn.mockImplementation(() => null);
    SignedOut.mockImplementation(({ children }) => <>{children}</>);
    renderOwner();
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/');
  });
});
