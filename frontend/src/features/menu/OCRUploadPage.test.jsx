import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OCRUploadPage from './OCRUploadPage';

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue('test-token') }),
}));

vi.mock('../../api', () => ({
  api: {
    uploadMenuAsync: vi.fn().mockResolvedValue({ task_id: 'task-123' }),
    getOCRStatus: vi.fn().mockResolvedValue({ status: 'pending' }),
  },
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('OCRUploadPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders without crashing', () => {
    render(
      <MemoryRouter>
        <OCRUploadPage />
      </MemoryRouter>
    );
    expect(document.body).toBeDefined();
  });
});
