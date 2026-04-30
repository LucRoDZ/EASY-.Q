import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, MessageSquare, UtensilsCrossed } from 'lucide-react';
import { api } from '../api';

export default function DashboardPage() {
  const [menus, setMenus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadMenus = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await api.getDashboardMenus();
        setMenus(data.menus || []);
      } catch (err) {
        setError(err.message || 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    };

    loadMenus();
  }, []);

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-black text-white">
        <div className="max-w-5xl mx-auto px-4 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">EasyQ Dashboard</h1>
            <p className="text-sm text-neutral-400">Monitor customer conversations</p>
          </div>
          <Link to="/" className="text-sm text-neutral-200 hover:text-white">
            Back to upload
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {loading ? (
          <div className="flex items-center gap-2 text-neutral-600">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading menus...
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        ) : menus.length === 0 ? (
          <div className="bg-white border border-neutral-200 rounded-xl p-8 text-center text-neutral-500">
            No menus uploaded yet.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {menus.map((menu) => (
              <Link
                key={menu.id}
                to={`/dashboard/${menu.slug}`}
                className="bg-white border border-neutral-200 rounded-xl p-5 hover:border-neutral-400 transition-colors"
              >
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold text-neutral-900">{menu.restaurant_name}</h2>
                  <UtensilsCrossed className="h-5 w-5 text-neutral-500" />
                </div>
                <p className="text-xs text-neutral-500 mb-4">/{menu.slug}</p>
                <div className="flex items-center gap-6 text-sm text-neutral-700">
                  <span className="flex items-center gap-1">
                    <MessageSquare className="h-4 w-4" />
                    {menu.conversation_count} conversations
                  </span>
                  <span>{menu.message_count} messages</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
