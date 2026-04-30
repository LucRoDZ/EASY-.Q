/**
 * DashboardConversationsPage — list all chatbot conversations for a menu.
 *
 * Features:
 *  - Search/filter by session ID or message content
 *  - Sentiment badge (keyword-based: positive / negative / neutral)
 *  - CSV export of all conversations
 *  - Expandable message threads
 */

import { useEffect, useState, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Loader2, ArrowLeft, Search, Download, ChevronDown, ChevronUp,
  MessageSquare, Smile, Frown, Minus,
} from 'lucide-react';
import { api } from '../api';

// ---------------------------------------------------------------------------
// Sentiment detection (keyword-based)
// ---------------------------------------------------------------------------

const POSITIVE_KEYWORDS = [
  'excellent', 'délicieux', 'parfait', 'super', 'génial', 'merci', 'bravo',
  'great', 'amazing', 'love', 'perfect', 'thank', 'wonderful', 'best',
  'excelente', 'delicioso', 'gracias', 'bueno', 'fantástico',
];
const NEGATIVE_KEYWORDS = [
  'mauvais', 'nul', 'décevant', 'froid', 'lent', 'problème', 'erreur',
  'bad', 'wrong', 'cold', 'slow', 'issue', 'problem', 'error', 'awful',
  'malo', 'frio', 'lento', 'problema',
];

function detectSentiment(messages) {
  if (!messages?.length) return 'neutral';
  const text = messages
    .map((m) => (m.content || '').toLowerCase())
    .join(' ');
  const pos = POSITIVE_KEYWORDS.filter((w) => text.includes(w)).length;
  const neg = NEGATIVE_KEYWORDS.filter((w) => text.includes(w)).length;
  if (pos > neg) return 'positive';
  if (neg > pos) return 'negative';
  return 'neutral';
}

const SENTIMENT_CONFIG = {
  positive: { icon: Smile,  label: 'Positif',  classes: 'bg-neutral-100 text-neutral-700' },
  negative: { icon: Frown,  label: 'Négatif',  classes: 'bg-neutral-200 text-neutral-500' },
  neutral:  { icon: Minus,  label: 'Neutre',   classes: 'bg-neutral-50 text-neutral-400' },
};

function SentimentBadge({ sentiment }) {
  const cfg = SENTIMENT_CONFIG[sentiment] || SENTIMENT_CONFIG.neutral;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.classes}`}>
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function exportToCsv(conversations, slug) {
  const rows = [['session_id', 'created_at', 'sentiment', 'role', 'content']];
  for (const conv of conversations) {
    const sentiment = detectSentiment(conv.messages);
    for (const msg of conv.messages || []) {
      rows.push([
        conv.session_id,
        conv.created_at || '',
        sentiment,
        msg.role || '',
        (msg.content || '').replace(/"/g, '""'),
      ]);
    }
  }
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `conversations-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Conversation card
// ---------------------------------------------------------------------------

function ConversationCard({ conv }) {
  const [expanded, setExpanded] = useState(false);
  const sentiment = detectSentiment(conv.messages);
  const msgCount = (conv.messages || []).length;

  const formatDate = (iso) => {
    try {
      return new Date(iso).toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return iso || '—';
    }
  };

  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
      {/* Header row */}
      <button
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-neutral-50 transition-colors text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <MessageSquare size={15} className="text-neutral-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-neutral-900 truncate">
              {conv.session_id}
            </p>
            <p className="text-xs text-neutral-400 mt-0.5">
              {formatDate(conv.created_at)} · {msgCount} message{msgCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-4">
          <SentimentBadge sentiment={sentiment} />
          {expanded ? (
            <ChevronUp size={15} className="text-neutral-400" />
          ) : (
            <ChevronDown size={15} className="text-neutral-400" />
          )}
        </div>
      </button>

      {/* Messages */}
      {expanded && (
        <div className="border-t border-neutral-100 divide-y divide-neutral-50">
          {(conv.messages || []).map((msg, i) => (
            <div
              key={i}
              className={`px-5 py-3 ${
                msg.role === 'user' ? 'bg-neutral-50' : 'bg-white'
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-1">
                {msg.role === 'user' ? 'Client' : 'Assistant'}
              </p>
              <p className="text-sm text-neutral-800 whitespace-pre-wrap leading-relaxed">
                {msg.content}
              </p>
              {msg.trace?.trace_url && (
                <a
                  href={msg.trace.trace_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-1.5 text-xs text-neutral-500 hover:text-neutral-700 underline"
                >
                  Trace Langfuse ↗
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DashboardConversationsPage() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sentimentFilter, setSentimentFilter] = useState('all');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await api.getDashboardConversations(slug);
        setData(response);
      } catch (err) {
        setError(err.message || 'Impossible de charger les conversations.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [slug]);

  const allConversations = data?.conversations || [];

  // Attach computed sentiment to each conversation for filtering
  const enriched = useMemo(
    () =>
      allConversations.map((c) => ({
        ...c,
        _sentiment: detectSentiment(c.messages),
      })),
    [allConversations]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enriched.filter((conv) => {
      if (sentimentFilter !== 'all' && conv._sentiment !== sentimentFilter) {
        return false;
      }
      if (!q) return true;
      if (conv.session_id?.toLowerCase().includes(q)) return true;
      return (conv.messages || []).some((m) =>
        (m.content || '').toLowerCase().includes(q)
      );
    });
  }, [enriched, query, sentimentFilter]);

  const sentimentCounts = useMemo(() => {
    const counts = { positive: 0, negative: 0, neutral: 0 };
    enriched.forEach((c) => {
      counts[c._sentiment] = (counts[c._sentiment] || 0) + 1;
    });
    return counts;
  }, [enriched]);

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/restaurant/dashboard" className="text-neutral-400 hover:text-white transition-colors">
              <ArrowLeft size={18} />
            </Link>
            <div>
              <span className="font-semibold">Conversations</span>
              {data?.menu?.restaurant_name && (
                <span className="ml-2 text-neutral-400 text-sm hidden sm:inline">
                  · {data.menu.restaurant_name}
                </span>
              )}
            </div>
          </div>
          {allConversations.length > 0 && (
            <button
              onClick={() => exportToCsv(allConversations, slug)}
              className="flex items-center gap-1.5 text-sm text-neutral-300 hover:text-white transition-colors"
            >
              <Download size={15} />
              <span className="hidden sm:inline">Exporter CSV</span>
            </button>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-5">

        {loading && (
          <div className="flex items-center gap-2 text-neutral-500 py-8">
            <Loader2 size={18} className="animate-spin" />
            Chargement des conversations…
          </div>
        )}

        {error && !loading && (
          <div className="bg-white border border-neutral-200 rounded-xl p-5 text-sm text-neutral-600">
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-neutral-200 p-4 text-center">
                <p className="text-2xl font-semibold text-neutral-900">{allConversations.length}</p>
                <p className="text-xs text-neutral-400 mt-0.5">Sessions</p>
              </div>
              {['positive', 'negative', 'neutral'].map((s) => {
                const cfg = SENTIMENT_CONFIG[s];
                return (
                  <div key={s} className="bg-white rounded-xl border border-neutral-200 p-4 text-center">
                    <p className="text-2xl font-semibold text-neutral-900">{sentimentCounts[s]}</p>
                    <p className={`text-xs mt-0.5 font-medium ${s === 'positive' ? 'text-neutral-600' : s === 'negative' ? 'text-neutral-400' : 'text-neutral-300'}`}>
                      {cfg.label}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Search + sentiment filter */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Rechercher une session ou un message…"
                  className="w-full pl-9 pr-4 py-2.5 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-800 placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
                />
              </div>
              <div className="flex rounded-xl border border-neutral-200 overflow-hidden bg-white text-sm shrink-0">
                {['all', 'positive', 'negative', 'neutral'].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSentimentFilter(s)}
                    className={`px-3 py-2 transition-colors ${
                      sentimentFilter === s
                        ? 'bg-black text-white'
                        : 'text-neutral-500 hover:bg-neutral-50'
                    }`}
                  >
                    {s === 'all' ? 'Tous' : SENTIMENT_CONFIG[s]?.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Conversation list */}
            {filtered.length === 0 ? (
              <div className="bg-white border border-neutral-200 rounded-xl p-10 text-center text-sm text-neutral-400">
                {allConversations.length === 0
                  ? 'Aucune conversation pour ce menu.'
                  : 'Aucun résultat pour ces filtres.'}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-neutral-400">
                  {filtered.length} conversation{filtered.length !== 1 ? 's' : ''}
                  {filtered.length !== allConversations.length && ` (sur ${allConversations.length})`}
                </p>
                {filtered.map((conv) => (
                  <ConversationCard key={conv.id} conv={conv} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
