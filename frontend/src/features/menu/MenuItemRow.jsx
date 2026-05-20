import { useState, memo } from 'react';
import { GripVertical, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
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

function MenuItemRow({ item, onUpdate, onDelete, dragListeners }) {
  const [open, setOpen] = useState(false);

  const set = (field, val) => onUpdate({ ...item, [field]: val });

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
          onChange={(e) => set('price', e.target.value === '' ? '' : parseFloat(e.target.value))}
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
