import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminDashboardPage from './AdminDashboardPage';

vi.mock('../../api', () => ({
  api: {
    getAdminStats: vi.fn().mockResolvedValue({ total_restaurants: 0, active_subscriptions: 0, total_revenue: 0 }),
    getAdminRestaurants: vi.fn().mockResolvedValue({ restaurants: [], total: 0 }),
    getAdminSubscriptions: vi.fn().mockResolvedValue({ subscriptions: [], total: 0 }),
    getAdminAuditLogs: vi.fn().mockResolvedValue({ logs: [], total: 0 }),
    patchAdminRestaurantStatus: vi.fn().mockResolvedValue({}),
  },
}));

describe('AdminDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders without crashing', () => {
    render(
      <MemoryRouter>
        <AdminDashboardPage />
      </MemoryRouter>
    );
    expect(document.body).toBeDefined();
  });
});
