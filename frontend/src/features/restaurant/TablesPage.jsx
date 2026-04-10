import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Loader2, Download, Plus, QrCode, Trash2, AlertCircle, Palette, ChevronDown, ChevronUp,
} from 'lucide-react';
import { api } from '../../api';

// ─── QR Color Presets ─────────────────────────────────────────────────────────

const PRESET_SCHEMES = [
  { label: 'Classique',  fill: '#000000', back: '#ffffff' },
  { label: 'Inversé',    fill: '#ffffff', back: '#000000' },
  { label: 'Marine',     fill: '#1e3a5f', back: '#ffffff' },
  { label: 'Forêt',      fill: '#14532d', back: '#f0fdf4' },
  { label: 'Bordeaux',   fill: '#7f1d1d', back: '#fef2f2' },
];

// ─── QrCustomizer ─────────────────────────────────────────────────────────────

function QrCustomizer({ settings, onChange }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-neutral-200">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-neutral-800 hover:bg-neutral-50 rounded-xl transition-colors"
      >
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-neutral-500" />
          Personnalisation des QR codes
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-neutral-400" /> : <ChevronDown className="h-4 w-4 text-neutral-400" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-neutral-100">
          {/* Presets */}
          <div className="pt-4">
            <p className="text-xs text-neutral-500 mb-2">Schémas prédéfinis</p>
            <div className="flex flex-wrap gap-2">
              {PRESET_SCHEMES.map((s) => {
                const active = settings.fillColor === s.fill && settings.backColor === s.back;
                return (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => onChange({ ...settings, fillColor: s.fill, backColor: s.back })}
                    className={[
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-colors',
                      active
                        ? 'border-neutral-900 bg-neutral-900 text-white'
                        : 'border-neutral-200 hover:border-neutral-400 text-neutral-700',
                    ].join(' ')}
                  >
                    <span
                      className="w-3 h-3 rounded-sm border border-neutral-300 shrink-0"
                      style={{ background: s.fill }}
                    />
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom color pickers */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-neutral-500 mb-1.5">Couleur du QR</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={settings.fillColor}
                  onChange={(e) => onChange({ ...settings, fillColor: e.target.value })}
                  className="w-8 h-8 rounded cursor-pointer border border-neutral-200 p-0.5"
                />
                <span className="text-xs text-neutral-500 font-mono">{settings.fillColor}</span>
              </div>
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1.5">Couleur du fond</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={settings.backColor}
                  onChange={(e) => onChange({ ...settings, backColor: e.target.value })}
                  className="w-8 h-8 rounded cursor-pointer border border-neutral-200 p-0.5"
                />
                <span className="text-xs text-neutral-500 font-mono">{settings.backColor}</span>
              </div>
            </div>
          </div>

          {/* Logo overlay */}
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.showLogo}
              onChange={(e) => onChange({ ...settings, showLogo: e.target.checked })}
              className="mt-0.5 rounded border-neutral-300"
            />
            <div>
              <span className="text-sm text-neutral-700">Intégrer le logo au centre du QR code</span>
              <p className="text-xs text-neutral-400 mt-0.5">
                Le logo doit être configuré dans les paramètres restaurant.
              </p>
            </div>
          </label>
        </div>
      )}
    </div>
  );
}

// ─── AddTablesForm ────────────────────────────────────────────────────────────

function AddTablesForm({ menuSlug, onAdded }) {
  const [count, setCount] = useState(10);
  const [prefix, setPrefix] = useState('Table');
  const [startAt, setStartAt] = useState(1);
  const [zone, setZone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const tables = await api.createTablesBulk({
        menu_slug: menuSlug,
        count: Number(count),
        prefix,
        start_at: Number(startAt),
        zone: zone || null,
      });
      onAdded(tables);
      setStartAt((prev) => Number(prev) + Number(count));
    } catch (err) {
      setError(err.message || 'Erreur lors de la création');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-xl border border-neutral-200 p-5 space-y-4"
    >
      <h3 className="text-sm font-semibold text-neutral-800">Ajouter des tables</h3>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs text-neutral-500 mb-1">Nombre</label>
          <input
            type="number"
            min={1}
            max={200}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500 mb-1">Préfixe</label>
          <input
            type="text"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="Table"
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500 mb-1">Départ</label>
          <input
            type="number"
            min={1}
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500 mb-1">Zone (optionnel)</label>
          <input
            type="text"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            placeholder="Terrasse, Salle…"
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
          />
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="flex items-center gap-2 bg-black text-white rounded-full px-5 py-2 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50 transition-colors"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Créer {count} table{count > 1 ? 's' : ''}
      </button>
    </form>
  );
}

// ─── TableCard ────────────────────────────────────────────────────────────────

function TableCard({ table, qrSrc, onDelete }) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Supprimer la table ${table.number} ?`)) return;
    setDeleting(true);
    try {
      await api.deleteTable(table.id);
      onDelete(table.id);
    } catch {
      setDeleting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-neutral-200 p-5 flex flex-col gap-3">
      {/* QR code image */}
      <div className="flex justify-center">
        <img
          src={qrSrc}
          alt={`QR Table ${table.number}`}
          className="w-28 h-28 rounded-lg border border-neutral-100"
          loading="lazy"
        />
      </div>

      {/* Info */}
      <div className="text-center">
        <p className="text-base font-semibold text-neutral-900">
          Table {table.number}
        </p>
        {table.label && (
          <p className="text-xs text-neutral-500 mt-0.5">{table.label}</p>
        )}
        <span className="inline-block mt-1.5 px-2 py-0.5 bg-neutral-100 text-neutral-600 rounded-full text-xs">
          {table.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>

      {/* Actions */}
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className="flex items-center justify-center gap-1.5 text-xs text-neutral-400 hover:text-red-500 transition-colors disabled:opacity-40"
      >
        {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        Supprimer
      </button>
    </div>
  );
}

// ─── TablesPage ───────────────────────────────────────────────────────────────

export default function TablesPage() {
  const { menuSlug } = useParams();
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [qrSettings, setQrSettings] = useState({
    fillColor: '#000000',
    backColor: '#ffffff',
    showLogo: false,
  });

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!menuSlug) return;
    api.listTables(menuSlug)
      .then(setTables)
      .catch((err) => setLoadError(err.message || 'Impossible de charger les tables'))
      .finally(() => setLoading(false));
  }, [menuSlug]);

  // ── Build QR URL with current settings ────────────────────────────────────

  const qrSrc = useCallback(
    (table) => {
      const params = new URLSearchParams({
        fill_color: qrSettings.fillColor,
        back_color: qrSettings.backColor,
        logo: qrSettings.showLogo ? 'true' : 'false',
      });
      return `${table.qr_url}?${params}`;
    },
    [qrSettings],
  );

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleAdded = useCallback((newTables) => {
    setTables((prev) => [...prev, ...newTables]);
  }, []);

  const handleDelete = useCallback((id) => {
    setTables((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      await api.downloadTableQrPdf(menuSlug, 'Restaurant', qrSettings);
    } catch (err) {
      alert(err.message || 'Échec de l\'export PDF');
    } finally {
      setExporting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-neutral-300" />
            <h1 className="text-lg font-semibold tracking-tight">
              Tables — {menuSlug}
            </h1>
          </div>

          <button
            type="button"
            onClick={handleExportPDF}
            disabled={exporting || tables.length === 0}
            className="flex items-center gap-2 text-sm bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-full transition-colors disabled:opacity-40"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Exporter PDF
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Add tables form */}
        <AddTablesForm menuSlug={menuSlug} onAdded={handleAdded} />

        {/* QR customization */}
        <QrCustomizer settings={qrSettings} onChange={setQrSettings} />

        {/* Tables grid */}
        {loading ? (
          <div className="flex items-center gap-2 text-neutral-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Chargement…
          </div>
        ) : loadError ? (
          <div className="flex items-center gap-2 text-red-500 text-sm">
            <AlertCircle className="h-5 w-5" />
            {loadError}
          </div>
        ) : tables.length === 0 ? (
          <div className="bg-white rounded-xl border border-neutral-200 p-8 text-center text-neutral-400 text-sm">
            Aucune table créée. Utilisez le formulaire ci-dessus pour commencer.
          </div>
        ) : (
          <>
            <p className="text-sm text-neutral-500">
              {tables.length} table{tables.length !== 1 ? 's' : ''} active{tables.length !== 1 ? 's' : ''}
            </p>
            <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {tables.map((table) => (
                <TableCard
                  key={table.id}
                  table={table}
                  qrSrc={qrSrc(table)}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
