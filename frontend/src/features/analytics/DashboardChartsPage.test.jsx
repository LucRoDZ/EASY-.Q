import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import DashboardChartsPage from './DashboardChartsPage';

vi.mock('../../api', () => ({
  api: {
    getAnalyticsSummary: vi.fn().mockResolvedValue({ revenue: 0, covers: 0, avg_basket: 0, tips: 0 }),
    getAnalyticsRevenue: vi.fn().mockResolvedValue([]),
    getAnalyticsCovers: vi.fn().mockResolvedValue([]),
    getAnalyticsChatbot: vi.fn().mockResolvedValue({ sessions: 0, messages: 0, avg_per_session: 0 }),
    getAnalyticsItems: vi.fn().mockResolvedValue([]),
    exportAnalyticsCsv: vi.fn().mockResolvedValue({}),
  },
}));

describe('DashboardChartsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(
      <MemoryRouter initialEntries={['/analytics?slug=test-slug']}>
        <Routes>
          <Route path="/analytics" element={<DashboardChartsPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(document.body).toBeDefined();
  });
});
