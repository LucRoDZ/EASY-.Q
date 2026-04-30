/**
 * ChatWidget — Enhanced AI assistant for the client menu page.
 *
 * Improvements over the original src/components/ChatWidget.jsx:
 * - Quick suggestion chips: wine pairings, allergens, specials, vegetarian
 * - FAB pulse ring animation for first-time discovery (auto-stops after 6s)
 * - Rises above CartSummaryBar when cart has items
 * - DishButton cart integration + streaming cursor unchanged
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Loader2, Bot, ShoppingCart, Check, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { t } from '../../localization/translations';
import { useCart } from '../../context/CartContext';

// ─── Quick suggestions (localized) ───────────────────────────────────────────

const SUGGESTIONS = {
  fr: [
    { label: '🍷 Accords vins', prompt: 'Peux-tu me recommander des accords mets/vins pour ce soir ?' },
    { label: '⭐ Spécialités', prompt: 'Quelles sont les spécialités maison à ne pas manquer ?' },
    { label: '🌾 Sans gluten', prompt: 'Quels plats sont sans gluten ou adaptés aux intolérances ?' },
    { label: '🥗 Végétarien', prompt: 'Avez-vous de bonnes options végétariennes ou vegan ?' },
  ],
  en: [
    { label: '🍷 Wine pairings', prompt: 'Can you recommend wine pairings for my meal tonight?' },
    { label: '⭐ House specials', prompt: 'What are the must-try house specialties today?' },
    { label: '🌾 Gluten-free', prompt: 'Which dishes are gluten-free or allergy-friendly?' },
    { label: '🥗 Vegetarian', prompt: 'Do you have good vegetarian or vegan options?' },
  ],
  es: [
    { label: '🍷 Maridaje', prompt: '¿Puedes recomendarme maridajes de vinos para esta noche?' },
    { label: '⭐ Especialidades', prompt: '¿Cuáles son las especialidades de la casa imprescindibles?' },
    { label: '🌾 Sin gluten', prompt: '¿Qué platos son sin gluten o aptos para intolerancias?' },
    { label: '🥗 Vegetariano', prompt: '¿Tienen buenas opciones vegetarianas o veganas?' },
  ],
};

// ─── DishButton ───────────────────────────────────────────────────────────────

function DishButton({ name, item, onAdd }) {
  const [added, setAdded] = useState(false);

  const handleClick = () => {
    let price = item.price;
    if (typeof price === 'string') {
      price = parseFloat(price.replace(/[^0-9.,]/g, '').replace(',', '.'));
    }
    if (isNaN(price) || price == null) price = 0;
    onAdd(item.name || name, price);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded-md transition-all mx-0.5 ${
        added
          ? 'bg-green-100 text-green-700'
          : 'bg-neutral-100 hover:bg-neutral-200 text-black'
      }`}
      title={added ? 'Ajouté !' : 'Ajouter au panier'}
    >
      {name}
      {added ? <Check size={12} /> : <ShoppingCart size={12} />}
    </button>
  );
}

// ─── Message parser ──────────────────────────────────────────────────────────

function parseContent(content, onAddToCart, menuItems) {
  if (!content) return null;

  const parts = [];
  let lastIndex = 0;
  const regex = /\*\*([^*]+)\*\*/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    }
    const dishName = match[1];
    const menuItem = menuItems.find((item) => {
      if (!item.name) return false;
      const a = item.name.toLowerCase().trim();
      const b = dishName.toLowerCase().trim();
      return a === b || a.includes(b) || b.includes(a);
    });
    if (menuItem && menuItem.price != null) {
      parts.push({ type: 'dish', name: dishName, item: menuItem });
    } else {
      parts.push({ type: 'bold', content: dishName });
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < content.length) {
    parts.push({ type: 'text', content: content.slice(lastIndex) });
  }

  return parts.map((part, i) => {
    if (part.type === 'text') return <span key={i}>{part.content}</span>;
    if (part.type === 'bold') return <strong key={i}>{part.content}</strong>;
    if (part.type === 'dish') return <DishButton key={i} name={part.name} item={part.item} onAdd={onAddToCart} />;
    return null;
  });
}

function resolveChatErrorKey(error) {
  const msg = String(error?.message || '').toLowerCase();
  if (msg.includes('resource_exhausted') || msg.includes('quota') || msg.includes('429')) {
    return 'chat.errorQuota';
  }
  return 'chat.error';
}

// ─── ChatWidget ───────────────────────────────────────────────────────────────

export default function ChatWidget({ slug, lang = 'fr', menuItems = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [showPulse, setShowPulse] = useState(true);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const { addItem, itemCount } = useCart();

  // Stop FAB pulse after 6s
  useEffect(() => {
    const timer = setTimeout(() => setShowPulse(false), 6000);
    return () => clearTimeout(timer);
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Load history when panel opens
  useEffect(() => {
    if (isOpen && !historyLoaded) loadHistory();
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  const loadHistory = async () => {
    try {
      const { messages: saved } = await api.getConversation(slug);
      setMessages(saved?.length ? saved : [{ role: 'assistant', content: t(lang, 'chat.welcome') }]);
    } catch {
      setMessages([{ role: 'assistant', content: t(lang, 'chat.welcome') }]);
    }
    setHistoryLoaded(true);
  };

  const handleClearHistory = async () => {
    await api.clearConversation(slug).catch(() => {});
    setMessages([{ role: 'assistant', content: t(lang, 'chat.welcome') }]);
  };

  const handleAddToCart = useCallback((name, price) => addItem(name, price), [addItem]);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loading) return;

    const userMessage = { role: 'user', content: text.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setStreamingContent('');

    try {
      let fullContent = '';
      for await (const chunk of api.chatStream(slug, newMessages, lang)) {
        fullContent += chunk;
        setStreamingContent(fullContent);
      }
      setMessages([...newMessages, { role: 'assistant', content: fullContent }]);
    } catch (error) {
      setMessages([...newMessages, { role: 'assistant', content: t(lang, resolveChatErrorKey(error)) }]);
    } finally {
      setStreamingContent('');
      setLoading(false);
    }
  }, [messages, loading, slug, lang]);

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleSuggestion = (prompt) => {
    sendMessage(prompt);
  };

  // Suggestions shown only on welcome screen (≤1 message = just the welcome)
  const showSuggestions = !loading && messages.length <= 1 && !streamingContent;
  const suggestions = SUGGESTIONS[lang] || SUGGESTIONS.fr;

  // Position: rise above CartSummaryBar (≈52px) when cart has items
  const fabBottom = itemCount > 0 ? 'bottom-20' : 'bottom-6';
  const panelBottom = itemCount > 0 ? 'bottom-20' : 'bottom-6';

  // ── FAB ────────────────────────────────────────────────────────────────────

  if (!isOpen) {
    return (
      <div className={`fixed ${fabBottom} right-6 z-50`}>
        {showPulse && (
          <span className="absolute inset-0 rounded-full bg-neutral-700 animate-ping opacity-40" />
        )}
        <button
          onClick={() => { setIsOpen(true); setShowPulse(false); }}
          className="relative w-14 h-14 bg-black text-white rounded-full shadow-lg hover:bg-neutral-800 flex items-center justify-center transition-all hover:scale-105"
          aria-label="Ouvrir l'assistant"
        >
          <MessageCircle size={24} />
        </button>
      </div>
    );
  }

  // ── Panel ──────────────────────────────────────────────────────────────────

  return (
    <div
      className={`fixed ${panelBottom} right-6 w-80 sm:w-96 h-[520px] bg-white rounded-2xl shadow-2xl border border-neutral-200 flex flex-col z-50 overflow-hidden`}
    >
      {/* Header */}
      <div className="bg-black text-white px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center">
            <Bot size={16} className="text-black" />
          </div>
          <span className="font-medium text-sm">{t(lang, 'chat.title')}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleClearHistory}
            className="hover:bg-neutral-800 p-1.5 rounded-full transition-colors"
            title={t(lang, 'chat.newConversation')}
          >
            <Trash2 size={15} />
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="hover:bg-neutral-800 p-1.5 rounded-full transition-colors"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-neutral-50">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 bg-black rounded-full flex items-center justify-center shrink-0 mt-0.5">
                <Bot size={14} className="text-white" />
              </div>
            )}
            <div
              className={`max-w-[80%] px-4 py-2.5 ${
                msg.role === 'user'
                  ? 'bg-black text-white rounded-2xl rounded-br-sm'
                  : 'bg-white text-neutral-900 rounded-2xl rounded-bl-sm border border-neutral-200'
              }`}
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {msg.role === 'assistant'
                  ? parseContent(msg.content, handleAddToCart, menuItems)
                  : msg.content}
              </p>
            </div>
          </div>
        ))}

        {/* Streaming bubble */}
        {streamingContent && (
          <div className="flex gap-2 justify-start">
            <div className="w-7 h-7 bg-black rounded-full flex items-center justify-center shrink-0 mt-0.5">
              <Bot size={14} className="text-white" />
            </div>
            <div className="max-w-[80%] px-4 py-2.5 bg-white text-neutral-900 rounded-2xl rounded-bl-sm border border-neutral-200">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {parseContent(streamingContent, handleAddToCart, menuItems)}
                <span className="inline-block w-1.5 h-4 bg-black animate-pulse ml-0.5 align-middle" />
              </p>
            </div>
          </div>
        )}

        {/* Typing indicator */}
        {loading && !streamingContent && (
          <div className="flex gap-2 justify-start">
            <div className="w-7 h-7 bg-black rounded-full flex items-center justify-center">
              <Loader2 size={14} className="text-white animate-spin" />
            </div>
            <div className="bg-white border border-neutral-200 px-4 py-2.5 rounded-2xl rounded-bl-sm">
              <p className="text-sm text-neutral-500">{t(lang, 'chat.thinking')}</p>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick suggestion chips */}
      {showSuggestions && (
        <div className="px-3 py-2 border-t border-neutral-100 bg-white shrink-0">
          <p className="text-xs text-neutral-400 mb-2">Suggestions rapides</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s.label}
                onClick={() => handleSuggestion(s.prompt)}
                className="text-xs px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-full transition-colors whitespace-nowrap"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-neutral-200 bg-white shrink-0">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t(lang, 'chat.placeholder')}
            className="flex-1 px-4 py-2.5 bg-neutral-100 border-none rounded-full focus:ring-2 focus:ring-black outline-none text-sm"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="w-10 h-10 bg-black text-white rounded-full flex items-center justify-center hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            <Send size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
