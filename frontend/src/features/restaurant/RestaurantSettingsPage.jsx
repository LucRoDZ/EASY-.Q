import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Loader2, Upload, Save, CheckCircle2, AlertCircle, Building2, Mail, MapPin } from 'lucide-react';
import { api } from '../../api';

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS = [
  { key: 'lundi',     label: 'Lundi' },
  { key: 'mardi',     label: 'Mardi' },
  { key: 'mercredi',  label: 'Mercredi' },
  { key: 'jeudi',     label: 'Jeudi' },
  { key: 'vendredi',  label: 'Vendredi' },
  { key: 'samedi',    label: 'Samedi' },
  { key: 'dimanche',  label: 'Dimanche' },
];

const DEFAULT_HOURS = { open: '09:00', close: '22:00', closed: false };

function buildDefaultHours() {
  return Object.fromEntries(DAYS.map(({ key }) => [key, { ...DEFAULT_HOURS }]));
}

// ─── Input ────────────────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700 mb-2">{label}</label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input
      type={type}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-4 py-3 bg-white border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-black text-sm"
    />
  );
}

// ─── LogoUpload ───────────────────────────────────────────────────────────────

function LogoUpload({ slug, logoUrl, onUploaded }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const { logo_url } = await api.uploadRestaurantLogo(slug, file);
      onUploaded(logo_url);
    } catch (e) {
      setError(e.message || 'Erreur upload');
    } finally {
      setUploading(false);
    }
  }, [slug, onUploaded]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700 mb-2">Logo</label>
      <div className="flex items-center gap-6">
        {/* Round preview */}
        <div className="w-24 h-24 rounded-full border border-neutral-200 bg-neutral-100 overflow-hidden shrink-0 flex items-center justify-center">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" />
          ) : (
            <Building2 size={28} className="text-neutral-300" />
          )}
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={[
            'flex-1 bg-white border rounded-lg p-6 text-center cursor-pointer transition-colors',
            dragging ? 'border-neutral-500 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-400',
          ].join(' ')}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          {uploading ? (
            <div className="flex items-center justify-center gap-2 text-neutral-500 text-sm">
              <Loader2 size={16} className="animate-spin" /> Envoi en cours…
            </div>
          ) : (
            <>
              <Upload size={20} className="mx-auto mb-2 text-neutral-400" />
              <p className="text-sm text-neutral-500">Glisser-déposer ou cliquer</p>
              <p className="text-xs text-neutral-400 mt-1">JPEG, PNG, WebP — max 5 Mo</p>
            </>
          )}
        </div>
      </div>
      {error && (
        <p className="flex items-center gap-1.5 text-sm text-red-600 mt-2">
          <AlertCircle size={14} /> {error}
        </p>
      )}
    </div>
  );
}

// ─── OpeningHoursGrid ─────────────────────────────────────────────────────────

function OpeningHoursGrid({ hours, onChange }) {
  const set = (day, field, val) =>
    onChange({ ...hours, [day]: { ...hours[day], [field]: val } });

  return (
    <div className="divide-y divide-neutral-100">
      {DAYS.map(({ key, label }) => {
        const day = hours[key] || DEFAULT_HOURS;
        return (
          <div key={key} className="grid grid-cols-4 items-center gap-3 py-3">
            <span className="text-sm font-medium text-neutral-900">{label}</span>
            <label className="flex items-center gap-2 text-sm text-neutral-500 col-span-1">
              <input
                type="checkbox"
                checked={day.closed}
                onChange={(e) => set(key, 'closed', e.target.checked)}
                className="rounded border-neutral-300"
              />
              Fermé
            </label>
            {!day.closed && (
              <>
                <input
                  type="time"
                  value={day.open || '09:00'}
                  onChange={(e) => set(key, 'open', e.target.value)}
                  disabled={day.closed}
                  className="border border-neutral-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
                <input
                  type="time"
                  value={day.close || '22:00'}
                  onChange={(e) => set(key, 'close', e.target.value)}
                  disabled={day.closed}
                  className="border border-neutral-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
              </>
            )}
            {day.closed && <span className="col-span-2 text-sm text-neutral-400 italic">Fermé ce jour</span>}
          </div>
        );
      })}
    </div>
  );
}

// ─── ProfilePreview ───────────────────────────────────────────────────────────

function ProfilePreview({ profile }) {
  return (
    <div className="bg-neutral-100 rounded-lg border border-neutral-200 p-4">
      <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">Aperçu</p>
      <div className="flex items-center gap-3 mb-3">
        {profile.logo_url ? (
          <img src={profile.logo_url} alt="Logo" className="w-10 h-10 rounded-full object-cover border border-neutral-200" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-white border border-neutral-200 flex items-center justify-center">
            <Building2 size={18} className="text-neutral-300" />
          </div>
        )}
        <div>
          <p className="font-semibold text-neutral-900 text-sm">{profile.name || 'Nom du restaurant'}</p>
          {profile.address && <p className="text-xs text-neutral-500">{profile.address}</p>}
        </div>
      </div>
      {profile.phone && <p className="text-xs text-neutral-600">{profile.phone}</p>}
    </div>
  );
}

// ─── RestaurantSettingsPage ───────────────────────────────────────────────────

export default function RestaurantSettingsPage() {
  const { slug } = useParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [hours, setHours] = useState(buildDefaultHours());
  const [googlePlaceId, setGooglePlaceId] = useState('');

  // Load profile
  useEffect(() => {
    api.getRestaurantProfile(slug)
      .then((p) => {
        setName(p.name || '');
        setOwnerEmail(p.owner_email || '');
        setAddress(p.address || '');
        setPhone(p.phone || '');
        setLogoUrl(p.logo_url || '');
        setHours(p.opening_hours || buildDefaultHours());
        setGooglePlaceId(p.google_place_id || '');
      })
      .catch(() => setError('Impossible de charger le profil.'))
      .finally(() => setLoading(false));
  }, [slug]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      await api.updateRestaurantProfile(slug, {
        name,
        owner_email: ownerEmail || null,
        address,
        phone,
        logo_url: logoUrl,
        opening_hours: hours,
        google_place_id: googlePlaceId || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e.message || 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-neutral-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 size={18} />
            <span className="font-semibold">Profil restaurant</span>
          </div>
          <Link to="/restaurant/dashboard" className="text-sm text-neutral-300 hover:text-white transition-colors">
            ← Tableau de bord
          </Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-white border border-neutral-200 rounded-xl p-4">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* Logo */}
        <section className="bg-white rounded-xl border border-neutral-200 p-6 space-y-4">
          <h2 className="font-semibold text-neutral-900">Identité visuelle</h2>
          <LogoUpload
            slug={slug}
            logoUrl={logoUrl}
            onUploaded={(url) => setLogoUrl(url)}
          />
        </section>

        {/* Infos générales */}
        <section className="bg-white rounded-xl border border-neutral-200 p-6 space-y-4">
          <h2 className="font-semibold text-neutral-900">Informations générales</h2>
          <Field label="Nom du restaurant">
            <TextInput value={name} onChange={setName} placeholder="Le Bistrot de la Paix" />
          </Field>
          <Field label="Adresse">
            <TextInput value={address} onChange={setAddress} placeholder="12 rue de la Paix, 75001 Paris" />
          </Field>
          <Field label="Téléphone">
            <TextInput value={phone} onChange={setPhone} placeholder="+33 1 23 45 67 89" type="tel" />
          </Field>
          <Field label={<span className="flex items-center gap-1.5"><Mail size={14} />Email de notification</span>}>
            <TextInput
              value={ownerEmail}
              onChange={setOwnerEmail}
              placeholder="proprietaire@restaurant.fr"
              type="email"
            />
            <p className="text-xs text-neutral-400 mt-1">Recevez les confirmations de paiement par email.</p>
          </Field>
          <Field label={<span className="flex items-center gap-1.5"><MapPin size={14} />Google Place ID</span>}>
            <TextInput
              value={googlePlaceId}
              onChange={setGooglePlaceId}
              placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
            />
            <p className="text-xs text-neutral-400 mt-1">
              Permet d&apos;afficher le bouton &quot;Laisser un avis Google&quot; après paiement.{' '}
              <a
                href="https://developers.google.com/maps/documentation/places/web-service/place-id"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-neutral-600"
              >
                Trouver mon Place ID
              </a>
            </p>
          </Field>
        </section>

        {/* Horaires */}
        <section className="bg-white rounded-xl border border-neutral-200 p-6 space-y-4">
          <h2 className="font-semibold text-neutral-900">Horaires d&apos;ouverture</h2>
          <OpeningHoursGrid hours={hours} onChange={setHours} />
        </section>

        {/* Preview */}
        <ProfilePreview profile={{ name, address, phone, logo_url: logoUrl }} />

        {/* Save */}
        <div className="space-y-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-black text-white rounded-full py-3 font-medium hover:bg-neutral-800 disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Sauvegarde…' : 'Sauvegarder'}
          </button>

          {saved && (
            <p className="flex items-center justify-center gap-2 text-sm text-neutral-600">
              <CheckCircle2 size={16} /> Profil sauvegardé
            </p>
          )}
        </div>

      </div>
    </div>
  );
}
