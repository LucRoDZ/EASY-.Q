import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Loader2, Languages, Save, AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Globe } from 'lucide-react';
import { api } from '../../api';

const LANG_LABELS = { en: 'English', es: 'Español' };

// ─── SectionPanel ──────────────────────────────────────────────────────────────

function SectionPanel({ section, editable, onChange }) {
  const [open, setOpen] = useState(true);

  const updateItem = (idx, field, val) => {
    const items = section.items.map((it, i) =>
      i === idx ? { ...it, [field]: val } : it
    );
    onChange({ ...section, items });
  };

  return (
    <div className="border border-neutral-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-neutral-50 text-left"
      >
        {editable ? (
          <input
            value={section.title || ''}
            onChange={(e) => onChange({ ...section, title: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-transparent font-semibold text-neutral-900 focus:outline-none border-b border-neutral-300 mr-2"
          />
        ) : (
          <span className="font-semibold text-neutral-900">{section.title}</span>
        )}
        {open ? <ChevronDown size={16} className="text-neutral-400 shrink-0" /> : <ChevronRight size={16} className="text-neutral-400 shrink-0" />}
      </button>

      {open && (
        <div className="divide-y divide-neutral-100">
          {(section.items || []).map((item, idx) => (
            <div key={idx} className="px-4 py-3">
              {editable ? (
                <>
                  <input
                    value={item.name || ''}
                    onChange={(e) => updateItem(idx, 'name', e.target.value)}
                    className="w-full text-sm font-medium text-neutral-900 focus:outline-none border-b border-neutral-200 mb-1 bg-transparent"
                  />
                  <input
                    value={item.description || ''}
                    onChange={(e) => updateItem(idx, 'description', e.target.value)}
                    placeholder="Description…"
                    className="w-full text-xs text-neutral-500 focus:outline-none bg-transparent"
                  />
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-neutral-900">{item.name}</p>
                  {item.description && (
                    <p className="text-xs text-neutral-500 mt-0.5">{item.description}</p>
                  )}
                </>
              )}
              {item.price != null && (
                <p className="text-xs text-neutral-400 mt-1">{item.price} €</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── TranslatorPage ────────────────────────────────────────────────────────────

export default function TranslatorPage() {
  const { menuId } = useParams();
  const [menu, setMenu] = useState(null);
  const [loadError, setLoadError] = useState('');

  const [targetLang, setTargetLang] = useState('en');
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState('');

  const [translated, setTranslated] = useState(null); // { sections, wines }
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [bulkTranslating, setBulkTranslating] = useState(false);
  const [bulkDone, setBulkDone] = useState(false);
  const [bulkError, setBulkError] = useState('');

  // ── Load menu ──────────────────────────────────────────────────────────────

  useEffect(() => {
    api.get(`/api/v1/menus/${menuId}`)
      .then((r) => setMenu(r.data))
      .catch(() => setLoadError('Impossible de charger le menu.'));
  }, [menuId]);

  // ── Pre-fill if translation already exists ─────────────────────────────────

  useEffect(() => {
    if (!menu) return;
    const data = menu._raw || {};
    if (data.translations?.[targetLang]) {
      setTranslated(data.translations[targetLang]);
    } else {
      setTranslated(null);
    }
  }, [menu, targetLang]);

  // ── Translate ──────────────────────────────────────────────────────────────

  const handleTranslate = async () => {
    setTranslating(true);
    setTranslateError('');
    setSaved(false);
    try {
      const res = await api.patch(`/api/v1/menus/${menuId}/translate?lang=${targetLang}`);
      setTranslated({ sections: res.data.sections, wines: res.data.wines });
    } catch (e) {
      setTranslateError(e?.response?.data?.detail || 'Erreur de traduction.');
    } finally {
      setTranslating(false);
    }
  };

  // ── Bulk translate all languages ───────────────────────────────────────────

  const handleBulkTranslate = async () => {
    setBulkTranslating(true);
    setBulkDone(false);
    setBulkError('');
    try {
      await api.post(`/api/v1/menus/${menuId}/translate/all`);
      setBulkDone(true);
      setTimeout(() => setBulkDone(false), 4000);
      // Reload menu to get fresh translations
      const r = await api.get(`/api/v1/menus/${menuId}`);
      setMenu(r.data);
    } catch (e) {
      setBulkError(e?.response?.data?.detail || 'Erreur lors de la traduction globale.');
    } finally {
      setBulkTranslating(false);
    }
  };

  // ── Save edits ─────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!translated) return;
    setSaving(true);
    setSaved(false);
    try {
      await api.patch(`/api/v1/menus/${menuId}/translations/${targetLang}`, {
        sections: translated.sections,
        wines: translated.wines,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // keep silent — the user sees the save button again
    } finally {
      setSaving(false);
    }
  };

  const updateTranslatedSection = (idx, section) =>
    setTranslated((prev) => ({
      ...prev,
      sections: prev.sections.map((s, i) => (i === idx ? section : s)),
    }));

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="flex items-center gap-2 text-neutral-600">
          <AlertCircle size={18} /> {loadError}
        </div>
      </div>
    );
  }

  if (!menu) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-neutral-400" />
      </div>
    );
  }

  const originalSections = menu.sections || [];

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Languages size={18} />
            <span className="font-semibold">Traduction automatique</span>
            <span className="text-neutral-400 text-sm">— {menu.restaurant_name}</span>
          </div>
          <Link
            to={`/menus/${menuId}/edit`}
            className="text-sm text-neutral-300 hover:text-white transition-colors"
          >
            ← Éditeur
          </Link>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8">

        {/* Controls */}
        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-5 mb-6 flex flex-wrap items-center gap-4">
          <div>
            <label className="text-xs text-neutral-500 block mb-1">Langue cible</label>
            <select
              value={targetLang}
              onChange={(e) => { setTargetLang(e.target.value); setTranslated(null); setSaved(false); }}
              className="border border-neutral-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400 bg-white"
            >
              {Object.entries(LANG_LABELS).map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleTranslate}
            disabled={translating}
            className="flex items-center gap-2 bg-black text-white rounded-full px-5 py-2 text-sm hover:bg-neutral-800 disabled:opacity-60 transition-colors"
          >
            {translating ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
            {translating ? 'Traduction en cours…' : 'Traduire automatiquement'}
          </button>

          {translated && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 border border-neutral-300 rounded-full px-5 py-2 text-sm hover:border-neutral-500 transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Sauvegarder
            </button>
          )}

          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-neutral-600">
              <CheckCircle2 size={15} /> Sauvegardé
            </span>
          )}

          {translateError && (
            <span className="flex items-center gap-1.5 text-sm text-red-600">
              <AlertCircle size={15} /> {translateError}
            </span>
          )}

          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={handleBulkTranslate}
              disabled={bulkTranslating}
              className="flex items-center gap-2 border border-neutral-300 rounded-full px-5 py-2 text-sm hover:border-neutral-500 disabled:opacity-60 transition-colors"
              title="Traduire automatiquement en anglais, français et espagnol"
            >
              {bulkTranslating ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
              {bulkTranslating ? 'Traduction…' : 'Tout traduire (EN / FR / ES)'}
            </button>

            {bulkDone && (
              <span className="flex items-center gap-1.5 text-sm text-neutral-600">
                <CheckCircle2 size={15} /> Toutes les langues traduites
              </span>
            )}
            {bulkError && (
              <span className="flex items-center gap-1.5 text-sm text-red-600">
                <AlertCircle size={15} /> {bulkError}
              </span>
            )}
          </div>
        </div>

        {/* Side-by-side */}
        {(originalSections.length > 0 || translated) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Original (FR) */}
            <div>
              <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
                Original (Français)
              </h2>
              <div className="space-y-3">
                {originalSections.map((section, idx) => (
                  <SectionPanel key={idx} section={section} editable={false} onChange={() => {}} />
                ))}
              </div>
            </div>

            {/* Translation */}
            <div>
              <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
                {LANG_LABELS[targetLang]} — éditable
              </h2>
              {!translated && !translating && (
                <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-neutral-400 text-sm">
                  Cliquez sur «&nbsp;Traduire automatiquement&nbsp;» pour lancer la traduction.
                </div>
              )}
              {translating && (
                <div className="rounded-xl border border-neutral-200 bg-white p-8 flex flex-col items-center gap-3 text-neutral-400 text-sm">
                  <Loader2 size={24} className="animate-spin" />
                  Traduction section par section via Gemini…
                </div>
              )}
              {translated && !translating && (
                <div className="space-y-3">
                  {(translated.sections || []).map((section, idx) => (
                    <SectionPanel
                      key={idx}
                      section={section}
                      editable
                      onChange={(s) => updateTranslatedSection(idx, s)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {originalSections.length === 0 && !translating && (
          <div className="rounded-xl border border-dashed border-neutral-300 p-12 text-center text-neutral-400">
            Ce menu n&apos;a pas encore de sections. Uploadez un PDF d&apos;abord.
          </div>
        )}
      </div>
    </div>
  );
}
