import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import KitchenScreen from './KitchenScreen';

// WebSocket is not available in jsdom — stub it globally
class MockWebSocket {
  constructor() {
    this.readyState = WebSocket.CONNECTING;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
  }
  send() {}
  close() {}
}
MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;

global.WebSocket = MockWebSocket;

describe('KitchenScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'setInterval').mockImplementation(() => 0);
    vi.spyOn(window, 'clearInterval').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders without crashing', () => {
    render(
      <MemoryRouter initialEntries={['/kds/test-slug']}>
        <Routes>
          <Route path="/kds/:slug" element={<KitchenScreen />} />
        </Routes>
      </MemoryRouter>
    );
    expect(document.body).toBeDefined();
  });
});
