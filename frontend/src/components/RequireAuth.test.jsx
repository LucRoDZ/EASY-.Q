import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequireAuth from './RequireAuth';

// Track where Navigate redirects
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

// Clerk SignedIn / SignedOut are controlled per-test via mockImplementation
vi.mock('@clerk/clerk-react', () => ({
  SignedIn: vi.fn(),
  SignedOut: vi.fn(),
}));

import { SignedIn, SignedOut } from '@clerk/clerk-react';

describe('RequireAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Navigate to "/" when user is signed out', () => {
    // Simulate signed-out state: SignedOut renders its children, SignedIn renders nothing
    SignedIn.mockImplementation(() => null);
    SignedOut.mockImplementation(({ children }) => <>{children}</>);

    render(
      <MemoryRouter>
        <RequireAuth>
          <div>Protected content</div>
        </RequireAuth>
      </MemoryRouter>
    );

    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/');
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('renders children when user is signed in', () => {
    // Simulate signed-in state: SignedIn renders its children, SignedOut renders nothing
    SignedIn.mockImplementation(({ children }) => <>{children}</>);
    SignedOut.mockImplementation(() => null);

    render(
      <MemoryRouter>
        <RequireAuth>
          <div>Protected content</div>
        </RequireAuth>
      </MemoryRouter>
    );

    expect(screen.getByText('Protected content')).toBeInTheDocument();
    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument();
  });
});
