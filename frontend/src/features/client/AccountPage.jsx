import { useUser, useClerk } from '@clerk/clerk-react';
import { LogOut, ShoppingBag, User } from 'lucide-react';

export default function AccountPage() {
  const { user } = useUser();
  const { signOut } = useClerk();

  const displayName = user?.fullName || user?.firstName || user?.primaryEmailAddress?.emailAddress || 'Mon compte';
  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const initials = (user?.firstName?.[0] ?? '') + (user?.lastName?.[0] ?? '');

  return (
    <div className="min-h-dvh bg-neutral-50">
      <header className="bg-white border-b border-neutral-200 px-4 py-4">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <h1 className="text-lg font-semibold text-neutral-900">Mon compte</h1>
          <button
            onClick={() => signOut()}
            className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-800 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Déconnexion
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-6 space-y-4">
        {/* Profil */}
        <div className="bg-white rounded-xl border border-neutral-200 p-5 flex items-center gap-4">
          {user?.imageUrl ? (
            <img src={user.imageUrl} alt="" className="w-12 h-12 rounded-full object-cover" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-neutral-200 flex items-center justify-center">
              {initials ? (
                <span className="text-sm font-semibold text-neutral-600 uppercase">{initials}</span>
              ) : (
                <User className="w-5 h-5 text-neutral-400" />
              )}
            </div>
          )}
          <div className="min-w-0">
            <p className="font-medium text-neutral-900 truncate">{displayName}</p>
            {email && <p className="text-sm text-neutral-500 truncate">{email}</p>}
          </div>
        </div>

        {/* Historique commandes */}
        <div className="bg-white rounded-xl border border-neutral-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <ShoppingBag className="w-4 h-4 text-neutral-400" />
            <h2 className="text-sm font-semibold text-neutral-700">Mes commandes</h2>
          </div>
          <p className="text-sm text-neutral-400 text-center py-6">
            Scannez le QR code d'une table pour passer une commande.
            <br />
            Vos commandes apparaîtront ici.
          </p>
        </div>
      </main>
    </div>
  );
}
