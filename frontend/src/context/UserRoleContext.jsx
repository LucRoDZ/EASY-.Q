import { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../api';

const UserRoleContext = createContext({ role: null, restaurantId: null, menuSlug: null, loading: true });

export function UserRoleProvider({ children }) {
  const { getToken, isSignedIn } = useAuth();
  const [state, setState] = useState({ role: null, restaurantId: null, menuSlug: null, loading: true });

  useEffect(() => {
    if (!isSignedIn) {
      setState({ role: null, restaurantId: null, menuSlug: null, loading: false });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const data = await api.getCurrentUser(token);
        if (!cancelled) {
          setState({
            role: data.role ?? null,
            restaurantId: data.restaurant_id ?? null,
            menuSlug: data.menu_slug ?? null,
            loading: false,
          });
        }
      } catch {
        if (!cancelled) setState({ role: null, restaurantId: null, menuSlug: null, loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, [isSignedIn, getToken]);

  return <UserRoleContext.Provider value={state}>{children}</UserRoleContext.Provider>;
}

export const useUserRole = () => useContext(UserRoleContext);
