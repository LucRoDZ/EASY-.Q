import { useState, useRef, memo } from 'react';
import { GripVertical, ChevronDown, ChevronRight, Trash2, ImagePlus, Loader2 } from 'lucide-react';
import AllergenIcons from '../../components/AllergenIcons';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLERGENS = [
  'gluten', 'lactose', 'oeufs', 'poisson', 'arachides', 'soja',
  'fruits_coque', 'celeri', 'moutarde', 'sesame', 'sulfites',
  'lupin', 'mollusques', 'crustaces',
];

const TAGS = [
  'vegetarien', 'vegan', 'halal', 'bio', 'maison', 'signature', 'nouveau',
];

// ─── TagPill ──────────────────────────────────────────────────────────────────

function TagPill({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'px-2 py-0.5 rounded-full text-xs font-medium transition-colors',
        active
          ? 'bg-neutral-800 text-white'
          : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

// ─── MenuItemRow ───────────────────────────────────────────────────────────────

function MenuItemRow({ item, onUpdate, onDelete, onUploadImage, dragListeners }) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);

  const set = (field, val) => onUpdate({ ...item, [field]: val });

  const handleImageFile = async (file) => {
    if (!file || !onUploadImage) return;
    setUploading(true);
    setUploadError('');
    try {
      await onUploadImage(file);
    } catch (err) {
      setUploadError(err.message || 'Erreur upload');
    } finally {
      setUploading(false);
    }
  };

  const toggleTag = (list, field, val) =>
    set(field, list.includes(val) ? list.filter((x) => x !== val) : [...list, val]);

  return (
    <div className="border-b border-neutral-100 last:border-0">
      {/* Collapsed row */}
      <div className="flex items-center gap-3 py-3 px-1">
        <span
          {...dragListeners}
          className="text-neutral-300 shrink-0 cursor-grab active:cursor-grabbing touch-none"
          aria-label="Déplacer"
        >
          <GripVertical className="h-4 w-4" />
        </span>
        <input
          className="flex-1 min-w-0 text-sm font-medium text-neutral-900 bg-transparent border-0 focus:outline-none focus:ring-0 placeholder:text-neutral-400"
          placeholder="Nom du plat"
          value={item.name}
          onChange={(e) => set('name', e.target.value)}
        />
        {/* Allergen icons for selected allergens — visible at a glance */}
        {item.allergens && item.allergens.length > 0 && (
          <div className="shrink-0">
            <AllergenIcons allergens={item.allergens} />
          </div>
        )}
        <input
          className="w-20 text-sm text-right tabular-nums font-semibold text-neutral-900 bg-transparent border-0 focus:outline-none focus:ring-0 placeholder:text-neutral-400"
          placeholder="0.00"
          value={item.price}
          type="number"
          min="0"
          step="0.5"
          onChange={(e) => set('price', e.target.value === '' ? null : parseFloat(e.target.value))}
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-neutral-400 hover:text-neutral-600 shrink-0"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="text-neutral-300 hover:text-red-400 shrink-0"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Expanded detail */}
      {open && (
        <div className="pb-4 px-8 space-y-3">
          {onUploadImage && (
            <div>
              <label className="block text-xs text-neutral-500 mb-1.5">Photo</label>
              <div className="flex items-center gap-3">
                {item.image_url && (
                  <img
                    src={item.image_url}
                    alt={item.name || 'Photo du plat'}
                    loading="lazy"
                    className="w-16 h-16 rounded-lg object-cover border border-neutral-200"
                  />
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => handleImageFile(e.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 text-xs text-neutral-600 border border-neutral-200 rounded-full px-3 py-1.5 hover:border-neutral-400 transition-colors disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                  {item.image_url ? 'Changer la photo' : 'Ajouter une photo'}
                </button>
              </div>
              {uploadError && <p className="text-xs text-red-600 mt-1">{uploadError}</p>}
            </div>
          )}

          <div>
            <label className="block text-xs text-neutral-500 mb-1">Description</label>
            <input
              className="w-full text-sm bg-white border border-neutral-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              placeholder="Courte description (optionnel)"
              value={item.description || ''}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs text-neutral-500 mb-1.5">Allergènes</label>
            <div className="flex flex-wrap gap-1.5">
              {ALLERGENS.map((a) => (
                <TagPill
                  key={a}
                  label={a}
                  active={item.allergens?.includes(a)}
                  onClick={() => toggleTag(item.allergens || [], 'allergens', a)}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-neutral-500 mb-1.5">Tags</label>
            <div className="flex flex-wrap gap-1.5">
              {TAGS.map((t) => (
                <TagPill
                  key={t}
                  label={t}
                  active={item.tags?.includes(t)}
                  onClick={() => toggleTag(item.tags || [], 'tags', t)}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-500">Disponible</label>
            <button
              type="button"
              onClick={() => set('is_available', !item.is_available)}
              className={[
                'relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors',
                item.is_available !== false ? 'bg-neutral-900' : 'bg-neutral-200',
              ].join(' ')}
            >
              <span
                className={[
                  'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition',
                  item.is_available !== false ? 'translate-x-4' : 'translate-x-0',
                ].join(' ')}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(MenuItemRow);
