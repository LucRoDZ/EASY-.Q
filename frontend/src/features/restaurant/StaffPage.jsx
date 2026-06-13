/**
 * StaffPage — gestion du personnel (owner).
 *
 * Route : /staff/:slug
 * Liste les membres, invite un serveur (nom + email + PIN optionnel),
 * active/désactive, change le rôle.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { Loader2, Users, UserPlus, AlertCircle, KeyRound, CheckCircle2 } from 'lucide-react';
import { api } from '../../api';

const ROLE_LABEL = {
  waiter: 'Serveur',
  kitchen: 'Cuisine',
  manager: 'Manager',
};

function InviteForm({ slug, getToken, onInvited }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('waiter');
  const [pin, setPin] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    if (pin && !/^\d{4}$/.test(pin)) {
      setError('Le PIN doit contenir exactement 4 chiffres.');
      return;
    }
    setSending(true);
    setError('');
    setSuccess('');
    try {
      const token = await getToken();
      const result = await api.inviteStaff(slug, {
        name: name.trim(),
        email: email.trim(),
        role,
        pin: pin || null,
      }, token);
      setSuccess(result.invitation_sent
        ? `Invitation envoyée à ${email}.`
        : `${name} ajouté. (Invitation email non envoyée — Clerk non configuré.)`);
      setName('');
      setEmail('');
      setPin('');
      onInvited();
    } catch (err) {
      setError(err.message || 'Erreur lors de l’invitation.');
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-neutral-200 p-6 space-y-4">
      <h2 className="font-semibold text-neutral-900 flex items-center gap-2">
        <UserPlus size={16} className="text-neutral-500" />
        Inviter un membre
      </h2>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="staff-name" className="block text-sm font-medium text-neutral-700 mb-1.5">Nom</label>
          <input
            id="staff-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Alice Martin"
            required
            className="w-full px-4 py-2.5 bg-white border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-black text-sm"
          />
        </div>
        <div>
          <label htmlFor="staff-email" className="block text-sm font-medium text-neutral-700 mb-1.5">Email</label>
          <input
            id="staff-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="alice@restaurant.fr"
            required
            className="w-full px-4 py-2.5 bg-white border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-black text-sm"
          />
        </div>
        <div>
          <label htmlFor="staff-role" className="block text-sm font-medium text-neutral-700 mb-1.5">Rôle</label>
          <select
            id="staff-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full px-4 py-2.5 bg-white border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-black text-sm"
          >
            <option value="waiter">Serveur</option>
            <option value="kitchen">Cuisine</option>
            <option value="manager">Manager</option>
          </select>
        </div>
        <div>
          <label htmlFor="staff-pin" className="block text-sm font-medium text-neutral-700 mb-1.5">
            PIN tablette (4 chiffres, optionnel)
          </label>
          <input
            id="staff-pin"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="1234"
            inputMode="numeric"
            className="w-full px-4 py-2.5 bg-white border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-black text-sm"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-sm text-red-600">
          <AlertCircle size={14} /> {error}
        </p>
      )}
      {success && (
        <p className="flex items-center gap-1.5 text-sm text-green-700">
          <CheckCircle2 size={14} /> {success}
        </p>
      )}

      <button
        type="submit"
        disabled={sending || !name.trim() || !email.trim()}
        className="inline-flex items-center gap-2 bg-black text-white rounded-full px-5 py-2.5 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50 transition-colors"
      >
        {sending ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
        Inviter
      </button>
    </form>
  );
}

export default function StaffPage() {
  const { slug } = useParams();
  const { getToken } = useAuth();

  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const data = await api.listStaff(slug, token);
      setStaff(data.staff ?? []);
    } catch {
      setError('Impossible de charger le personnel.');
    } finally {
      setLoading(false);
    }
  }, [slug, getToken]);

  useEffect(() => { load(); }, [load]);

  async function handleToggleActive(member) {
    try {
      const token = await getToken();
      if (member.is_active) {
        await api.deactivateStaff(slug, member.id, token);
      } else {
        await api.updateStaff(slug, member.id, { is_active: true }, token);
      }
      await load();
    } catch {
      // le rechargement périodique rattrapera
    }
  }

  async function handleSetPin(member) {
    const pin = window.prompt(`Nouveau PIN (4 chiffres) pour ${member.name} :`);
    if (pin == null) return;
    if (!/^\d{4}$/.test(pin)) {
      window.alert('Le PIN doit contenir exactement 4 chiffres.');
      return;
    }
    try {
      const token = await getToken();
      await api.updateStaff(slug, member.id, { pin }, token);
      await load();
    } catch (err) {
      window.alert(err.message || 'Erreur lors de la mise à jour du PIN.');
    }
  }

  return (
    <div className="min-h-dvh bg-neutral-50">
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={18} />
            <span className="font-semibold">Personnel</span>
          </div>
          <Link to="/restaurant/dashboard" className="text-sm text-neutral-300 hover:text-white transition-colors">
            ← Tableau de bord
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <InviteForm slug={slug} getToken={getToken} onInvited={load} />

        {loading ? (
          <div className="flex items-center gap-2 text-neutral-500">
            <Loader2 size={18} className="animate-spin" /> Chargement…
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-white border border-neutral-200 rounded-xl p-4">
            <AlertCircle size={16} /> {error}
          </div>
        ) : staff.length === 0 ? (
          <p className="text-sm text-neutral-500 text-center py-12">
            Aucun membre du personnel. Invitez votre premier serveur ci-dessus.
          </p>
        ) : (
          <div className="bg-white rounded-xl border border-neutral-200 divide-y divide-neutral-100">
            {staff.map((member) => (
              <div key={member.id} className="p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className={`font-medium text-sm ${member.is_active ? 'text-neutral-900' : 'text-neutral-400 line-through'}`}>
                    {member.name}
                  </p>
                  <p className="text-xs text-neutral-500 truncate">{member.email}</p>
                </div>
                <span className="text-xs bg-neutral-100 text-neutral-600 px-2.5 py-1 rounded-full shrink-0">
                  {ROLE_LABEL[member.role] || member.role}
                </span>
                {member.has_pin && (
                  <span title="PIN configuré" className="text-neutral-400 shrink-0">
                    <KeyRound size={14} />
                  </span>
                )}
                <button
                  onClick={() => handleSetPin(member)}
                  className="text-xs text-neutral-600 underline hover:text-black shrink-0"
                >
                  PIN
                </button>
                <button
                  onClick={() => handleToggleActive(member)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full shrink-0 transition-colors ${
                    member.is_active
                      ? 'border border-neutral-300 text-neutral-600 hover:bg-neutral-50'
                      : 'bg-black text-white hover:bg-neutral-800'
                  }`}
                >
                  {member.is_active ? 'Désactiver' : 'Réactiver'}
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
