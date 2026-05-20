import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { Loader2 } from 'lucide-react';
import { api } from '../api';

export default function AuthRedirect() {
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const token = await getToken();
        const data = await api.getDashboardMenus(token);
        if (cancelled) return;
        if (data?.menus?.length > 0) {
          navigate('/dashboard', { replace: true });
        } else {
          navigate('/onboarding', { replace: true });
        }
      } catch {
        if (!cancelled) navigate('/dashboard', { replace: true });
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    check();
    return () => { cancelled = true; };
  }, [getToken, navigate]);

  if (!checking) return null;

  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
    </div>
  );
}
