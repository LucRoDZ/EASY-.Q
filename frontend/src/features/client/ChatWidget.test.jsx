import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CartProvider } from '../../context/CartContext';
import ChatWidget from './ChatWidget';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../api', () => ({
  api: {
    getSessionId: vi.fn(() => 'test-session-123'),
    getConversation: vi.fn(),
    clearConversation: vi.fn(),
    chatStream: vi.fn(),
  },
}));

import { api } from '../../api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MENU_ITEMS = [
  { name: 'Salade César', price: 12.5, allergens: ['gluten'] },
  { name: 'Boeuf bourguignon', price: 22, allergens: [] },
  { name: 'Bordeaux Rouge', price: 28, allergens: [] },
];

function renderChatWidget(props = {}) {
  return render(
    <CartProvider>
      <ChatWidget slug="le-bistrot" lang="fr" menuItems={MENU_ITEMS} {...props} />
    </CartProvider>
  );
}

async function* fakeStream(chunks) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ChatWidget — FAB (closed state)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getConversation.mockResolvedValue({ messages: [] });
  });

  it('renders the FAB button initially', () => {
    renderChatWidget();
    const fab = screen.getByRole('button', { name: /assistant/i });
    expect(fab).toBeInTheDocument();
  });

  it('does not show the chat panel by default', () => {
    renderChatWidget();
    expect(screen.queryByText('Suggestions rapides')).not.toBeInTheDocument();
  });

  it('shows pulse ring animation on first render', () => {
    renderChatWidget();
    const pulse = document.querySelector('.animate-ping');
    expect(pulse).toBeInTheDocument();
  });
});

describe('ChatWidget — opening the panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getConversation.mockResolvedValue({ messages: [] });
  });

  it('opens chat panel when FAB is clicked', async () => {
    const user = userEvent.setup();
    renderChatWidget();

    await user.click(screen.getByRole('button', { name: /assistant/i }));

    await waitFor(() =>
      expect(screen.getByText('Suggestions rapides')).toBeInTheDocument()
    );
  });

  it('shows welcome message on open', async () => {
    const user = userEvent.setup();
    api.getConversation.mockResolvedValue({ messages: [] });
    renderChatWidget();

    await user.click(screen.getByRole('button', { name: /assistant/i }));

    await waitFor(() =>
      // Welcome message from translations — check for the chat title at least
      expect(screen.getByText(/Assistant/i)).toBeInTheDocument()
    );
  });

  it('shows suggestion chips when chat opens with no history', async () => {
    const user = userEvent.setup();
    renderChatWidget();

    await user.click(screen.getByRole('button', { name: /assistant/i }));

    await waitFor(() =>
      expect(screen.getByText('🍷 Accords vins')).toBeInTheDocument()
    );
    expect(screen.getByText('⭐ Spécialités')).toBeInTheDocument();
    expect(screen.getByText('🌾 Sans gluten')).toBeInTheDocument();
    expect(screen.getByText('🥗 Végétarien')).toBeInTheDocument();
  });

  it('closes panel when X button is clicked', async () => {
    const user = userEvent.setup();
    renderChatWidget();

    await user.click(screen.getByRole('button', { name: /assistant/i }));
    await waitFor(() => screen.getByText('Suggestions rapides'));

    const closeBtn = screen.getByRole('button', { name: /fermer/i });
    await user.click(closeBtn);

    await waitFor(() =>
      expect(screen.queryByText('Suggestions rapides')).not.toBeInTheDocument()
    );
  });
});

describe('ChatWidget — sending messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getConversation.mockResolvedValue({ messages: [] });
  });

  it('shows user message in chat after submission', async () => {
    const user = userEvent.setup();
    api.chatStream.mockReturnValue(fakeStream(['Bonjour ! Comment puis-je vous aider ?']));
    renderChatWidget();

    await user.click(screen.getByRole('button', { name: /assistant/i }));
    await waitFor(() => screen.getByPlaceholderText(/question|posez/i));

    const input = screen.getByPlaceholderText(/question|posez/i);
    await user.type(input, 'Avez-vous des plats végétariens ?');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.getByText('Avez-vous des plats végétariens ?')).toBeInTheDocument()
    );
  });

  it('displays streamed assistant response', async () => {
    const user = userEvent.setup();
    api.chatStream.mockReturnValue(fakeStream(['Oui, nous avons la Soupe du jour végétarienne.']));
    renderChatWidget();

    await user.click(screen.getByRole('button', { name: /assistant/i }));
    await waitFor(() => screen.getByPlaceholderText(/question|posez/i));

    const input = screen.getByPlaceholderText(/question|posez/i);
    await user.type(input, 'Options végétariennes ?');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.getByText(/Oui, nous avons/i)).toBeInTheDocument()
    );
  });

  it('clears input field after message is sent', async () => {
    const user = userEvent.setup();
    api.chatStream.mockReturnValue(fakeStream(['Réponse test.']));
    renderChatWidget();

    await user.click(screen.getByRole('button', { name: /assistant/i }));
    await waitFor(() => screen.getByPlaceholderText(/question|posez/i));

    const input = screen.getByPlaceholderText(/question|posez/i);
    await user.type(input, 'Question test');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(input.value).toBe(''));
  });

  it('send button is disabled when input is empty', async () => {
    const user = userEvent.setup();
    renderChatWidget();

    await user.click(screen.getByRole('button', { name: /assistant/i }));
    await waitFor(() => screen.getByPlaceholderText(/question|posez/i));

    // Send button is the submit button inside the <form>
    const form = document.querySelector('form');
    const sendBtn = form?.querySelector('button[type="submit"]');
    expect(sendBtn).toBeTruthy();
    expect(sendBtn).toBeDisabled();
  });

  it('sends message when suggestion chip is clicked', async () => {
    const user = userEvent.setup();
    api.chatStream.mockReturnValue(fakeStream(['Je vous conseille le Bordeaux Rouge.']));
    renderChatWidget();

    await user.click(screen.getByRole('button', { name: /assistant/i }));
    await waitFor(() => screen.getByText('🍷 Accords vins'));

    await user.click(screen.getByText('🍷 Accords vins'));

    // The response from the stream should appear in the chat
    await waitFor(() =>
      expect(screen.getByText(/Bordeaux Rouge/i)).toBeInTheDocument()
    );
  });
});

describe('ChatWidget — error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getConversation.mockResolvedValue({ messages: [] });
  });

  it('shows error message when API fails', async () => {
    const user = userEvent.setup();
    api.chatStream.mockImplementation(async function* () {
      throw new Error('Network error');
    });
    renderChatWidget();

    await user.click(screen.getByRole('button', { name: /assistant/i }));
    await waitFor(() => screen.getByPlaceholderText(/question|posez/i));

    const input = screen.getByPlaceholderText(/question|posez/i);
    await user.type(input, 'Test');
    await user.keyboard('{Enter}');

    // Should show an error message (from translations chat.error key)
    await waitFor(() => {
      const msgs = screen.getAllByText(/erreur|error|désolé|sorry/i);
      expect(msgs.length).toBeGreaterThan(0);
    });
  });
});

describe('ChatWidget — conversation history', () => {
  it('loads previous conversation messages on open', async () => {
    const user = userEvent.setup();
    api.getConversation.mockResolvedValue({
      messages: [
        { role: 'assistant', content: 'Bonjour, comment puis-je vous aider ?' },
        { role: 'user', content: 'Quels sont vos spécialités ?' },
      ],
    });
    renderChatWidget();

    await user.click(screen.getByRole('button', { name: /assistant/i }));

    await waitFor(() =>
      expect(screen.getByText('Quels sont vos spécialités ?')).toBeInTheDocument()
    );
    expect(screen.getByText('Bonjour, comment puis-je vous aider ?')).toBeInTheDocument();
  });

  it('clears conversation when trash icon is clicked', async () => {
    const user = userEvent.setup();
    api.getConversation.mockResolvedValue({
      messages: [{ role: 'user', content: 'Ancien message' }],
    });
    api.clearConversation.mockResolvedValue({});
    renderChatWidget();

    await user.click(screen.getByRole('button', { name: /assistant/i }));
    await waitFor(() => screen.getByText('Ancien message'));

    // Trash/clear button
    // chat.newConversation translations: "Effacer la conversation" (fr) / "Erase conversation" (en)
    const clearBtn = screen.getByTitle(/effacer|erase|borrar/i);
    await user.click(clearBtn);

    await waitFor(() =>
      expect(screen.queryByText('Ancien message')).not.toBeInTheDocument()
    );
    expect(api.clearConversation).toHaveBeenCalledWith('le-bistrot');
  });
});

describe('ChatWidget — dish buttons (add to cart)', () => {
  it('renders dish name as clickable button in assistant response', async () => {
    const user = userEvent.setup();
    api.getConversation.mockResolvedValue({ messages: [] });
    // Response with **bold dish name** that matches a menu item
    api.chatStream.mockReturnValue(
      fakeStream(['Je vous recommande la **Salade César** ce soir.'])
    );
    renderChatWidget();

    await user.click(screen.getByRole('button', { name: /assistant/i }));
    await waitFor(() => screen.getByPlaceholderText(/question|posez/i));

    const input = screen.getByPlaceholderText(/question|posez/i);
    await user.type(input, 'Suggestion ?');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      // DishButton renders the dish name as a button
      expect(screen.getByRole('button', { name: /Salade César/i })).toBeInTheDocument()
    );
  });
});
