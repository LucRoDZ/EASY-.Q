import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, BarChart2, QrCode, MessageSquare, Users, Sun, Moon } from 'lucide-react';
import { useDarkMode } from '../hooks/useDarkMode';

const tabs = (slug) => [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: slug ? `/analytics?slug=${slug}` : '/analytics', label: 'Analytics', icon: BarChart2 },
  { to: slug ? `/tables/${slug}` : '/dashboard', label: 'Tables', icon: QrCode },
  { to: slug ? `/staff/${slug}` : '/dashboard', label: 'Personnel', icon: Users },
  { to: slug ? `/dashboard/${slug}` : '/dashboard', label: 'Conversations', icon: MessageSquare },
];

export default function DashboardNav({ slug }) {
  const { pathname, search } = useLocation();
  const current = pathname + search;
  const [dark, setDark] = useDarkMode();

  const isActive = (to) => {
    if (to === '/dashboard') return pathname === '/dashboard';
    if (to.startsWith('/analytics')) return pathname === '/analytics';
    if (to.startsWith('/tables')) return pathname.startsWith('/tables');
    if (to.startsWith('/staff')) return pathname.startsWith('/staff');
    if (to.startsWith('/dashboard/')) return pathname.startsWith('/dashboard/');
    return false;
  };

  return (
    <nav className="bg-neutral-900 border-t border-neutral-800">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex items-center">
          {tabs(slug).map(({ to, label, icon: Icon }) => (
            <Link
              key={label}
              to={to}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors ${
                isActive(to)
                  ? 'text-white'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setDark((d) => !d)}
            aria-label={dark ? 'Passer en mode clair' : 'Passer en mode sombre'}
            className="ml-2 p-2 text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>
    </nav>
  );
}
