import { useCallback, useState } from 'react';
import { Wine, Plus, Check, X, ChevronRight, Search, Leaf, Wheat } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { t } from '../localization/translations';
import AllergenIcons, { ALLERGENS } from './AllergenIcons';

function formatPrice(price, currency) {
  if (price == null) return '';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'EUR',
    }).format(price);
  } catch {
    return `${price}`;
  }
}

// ─── Item Detail Modal ─────────────────────────────────────────────────────────

function ItemDetailModal({ item, currency, lang, onClose, onAdd }) {
  const [added, setAdded] = useState(false);

  const handleAdd = () => {
    onAdd(item);
    setAdded(true);
    setTimeout(() => {
      setAdded(false);
      onClose();
    }, 1000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-0 sm:px-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-neutral-100">
          <div className="flex-1 pr-4">
            <h3 className="text-lg font-bold text-neutral-900 leading-tight">{item.name}</h3>
            {item.price != null && (
              <p className="text-xl font-semibold text-neutral-900 mt-1">
                {formatPrice(item.price, currency)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-neutral-100 rounded-full transition-colors shrink-0"
          >
            <X className="h-5 w-5 text-neutral-500" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {item.description && (
            <p className="text-sm text-neutral-600 leading-relaxed">{item.description}</p>
          )}

          {/* Tags */}
          {item.tags && item.tags.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">
                Caractéristiques
              </p>
              <div className="flex flex-wrap gap-1.5">
                {item.tags.map((tag, i) => (
                  <span
                    key={i}
                    className="text-xs bg-neutral-100 text-neutral-700 px-2.5 py-1 rounded-full"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Allergens */}
          {item.allergens && item.allergens.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">
                Allergènes
              </p>
              <div className="flex flex-wrap gap-2">
                {item.allergens.map((code) => {
                  const info = ALLERGENS[code];
                  return info ? (
                    <span
                      key={code}
                      className="flex items-center gap-1.5 text-xs text-neutral-700 bg-neutral-50 border border-neutral-200 px-2.5 py-1 rounded-full"
                    >
                      <span className="w-4 h-4 rounded-full bg-neutral-800 text-white flex items-center justify-center shrink-0"
                        style={{ fontSize: '7px', fontWeight: 700 }}>
                        {info.abbr}
                      </span>
                      {info.label}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-neutral-100">
          <button
            type="button"
            onClick={handleAdd}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-full font-medium transition-all ${
              added
                ? 'bg-green-500 text-white'
                : 'bg-black text-white hover:bg-neutral-800'
            }`}
          >
            {added ? (
              <>
                <Check className="h-4 w-4" />
                {t(lang, 'added')}
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                {t(lang, 'addToCart')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MenuItem ─────────────────────────────────────────────────────────────────

function MenuItem({ item, currency, lang, onAdd, onOpenDetail }) {
  const [added, setAdded] = useState(false);

  const handleAdd = (e) => {
    e.stopPropagation();
    onAdd(item);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  return (
    <div
      className="py-4 border-b border-neutral-100 last:border-b-0 cursor-pointer hover:bg-neutral-50 -mx-2 px-2 rounded-lg transition-colors"
      onClick={() => onOpenDetail(item)}
    >
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <h4 className="font-medium text-neutral-900">{item.name}</h4>
            <ChevronRight className="h-3.5 w-3.5 text-neutral-300 shrink-0" />
          </div>
          {item.description && (
            <p className="text-sm text-neutral-500 mt-1 line-clamp-2">{item.description}</p>
          )}
          {item.tags && item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {item.tags.map((tag, i) => (
                <span
                  key={i}
                  className="text-xs bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          <AllergenIcons allergens={item.allergens} />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {item.price != null && (
            <span className="font-semibold text-neutral-900 whitespace-nowrap">
              {formatPrice(item.price, currency)}
            </span>
          )}
          <button
            onClick={handleAdd}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
              added
                ? 'bg-green-500 text-white'
                : 'bg-black text-white hover:bg-neutral-800'
            }`}
          >
            {added ? (
              <>
                <Check className="h-4 w-4" />
                {t(lang, 'added')}
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                {t(lang, 'addToCart')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── WineItem ─────────────────────────────────────────────────────────────────

function WineItem({ wine, currency, lang, onAdd }) {
  const [added, setAdded] = useState(false);
  const info = [wine.type, wine.region, wine.grape].filter(Boolean).join(' - ');

  const handleAdd = () => {
    onAdd({ name: wine.name, price: wine.price, description: info });
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  return (
    <div className="py-3 border-b border-neutral-100 last:border-b-0">
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1">
          <h4 className="font-medium text-neutral-900">{wine.name}</h4>
          {info && <p className="text-sm text-neutral-500 mt-0.5">{info}</p>}
        </div>
        <div className="flex items-center gap-2">
          {wine.price != null && (
            <span className="font-medium text-neutral-900 whitespace-nowrap">
              {formatPrice(wine.price, currency)}
            </span>
          )}
          <button
            onClick={handleAdd}
            className={`p-1.5 rounded-full transition-all ${
              added ? 'bg-green-500 text-white' : 'bg-black text-white hover:bg-neutral-800'
            }`}
          >
            {added ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SearchFilterBar ──────────────────────────────────────────────────────────

const DIET_FILTERS = [
  { id: 'vegetarian', label: 'Végétarien', icon: Leaf, tags: ['végétarien', 'vegetarian', 'végé'] },
  { id: 'vegan', label: 'Vegan', icon: Leaf, tags: ['vegan', 'végétalien'] },
  { id: 'glutenfree', label: 'Sans gluten', icon: Wheat, allergenExclude: ['gluten'] },
];

export function SearchFilterBar({ query, onQueryChange, activeFilters, onToggleFilter, lang }) {
  return (
    <div className="space-y-3 mb-6">
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={lang === 'fr' ? 'Rechercher un plat…' : lang === 'es' ? 'Buscar un plato…' : 'Search dishes…'}
          className="w-full pl-9 pr-4 py-2.5 border border-neutral-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Diet filter pills */}
      <div className="flex flex-wrap gap-2">
        {DIET_FILTERS.map((f) => {
          const active = activeFilters.includes(f.id);
          const Icon = f.icon;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onToggleFilter(f.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                active
                  ? 'bg-neutral-900 text-white border-neutral-900'
                  : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400'
              }`}
            >
              <Icon className="h-3 w-3" />
              {f.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── filter helpers ───────────────────────────────────────────────────────────

function itemMatchesFilters(item, query, activeFilters) {
  // Text search
  if (query) {
    const q = query.toLowerCase();
    const inName = item.name?.toLowerCase().includes(q);
    const inDesc = item.description?.toLowerCase().includes(q);
    const inTags = item.tags?.some((tag) => tag.toLowerCase().includes(q));
    if (!inName && !inDesc && !inTags) return false;
  }

  // Diet filters
  for (const filterId of activeFilters) {
    const def = DIET_FILTERS.find((f) => f.id === filterId);
    if (!def) continue;

    if (def.tags) {
      const hasTag = item.tags?.some((tag) =>
        def.tags.some((dt) => tag.toLowerCase().includes(dt))
      );
      if (!hasTag) return false;
    }

    if (def.allergenExclude) {
      const hasAllergen = def.allergenExclude.some((a) =>
        item.allergens?.includes(a)
      );
      if (hasAllergen) return false;
    }
  }

  return true;
}

// ─── MenuView ─────────────────────────────────────────────────────────────────

export default function MenuView({ sections, wines, currency, lang, query = '', activeFilters = [] }) {
  const { addItem } = useCart();
  const [detailItem, setDetailItem] = useState(null);

  const handleOpenDetail = useCallback((item) => setDetailItem(item), []);
  const handleCloseDetail = useCallback(() => setDetailItem(null), []);

  // Filter sections
  const filteredSections = (sections || [])
    .map((section) => ({
      ...section,
      items: (section.items || []).filter((item) =>
        itemMatchesFilters(item, query, activeFilters)
      ),
    }))
    .filter((section) => section.items.length > 0);

  const hasFilter = query || activeFilters.length > 0;
  const totalFiltered = filteredSections.reduce((acc, s) => acc + s.items.length, 0);

  return (
    <>
      {/* Item detail modal */}
      {detailItem && (
        <ItemDetailModal
          item={detailItem}
          currency={currency}
          lang={lang}
          onClose={handleCloseDetail}
          onAdd={addItem}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {hasFilter && (
            <p className="text-sm text-neutral-500">
              {totalFiltered} résultat{totalFiltered !== 1 ? 's' : ''}
            </p>
          )}

          {filteredSections.length === 0 && hasFilter ? (
            <div className="bg-white rounded-xl shadow-sm border border-neutral-200 p-8 text-center text-neutral-400 text-sm">
              Aucun plat ne correspond à votre recherche.
            </div>
          ) : (
            filteredSections.map((section, i) => (
              <div
                key={i}
                id={`section-${i}`}
                className="bg-white rounded-xl shadow-sm border border-neutral-200 p-6"
              >
                <h3 className="text-lg font-bold text-neutral-900 mb-4 pb-2 border-b border-neutral-200 uppercase tracking-wide">
                  {section.title}
                </h3>
                <div>
                  {section.items.map((item, j) => (
                    <MenuItem
                      key={j}
                      item={item}
                      currency={currency}
                      lang={lang}
                      onAdd={addItem}
                      onOpenDetail={handleOpenDetail}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {wines && wines.length > 0 && (
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-sm border border-neutral-200 p-6 sticky top-24">
              <h3 className="text-lg font-bold text-neutral-900 mb-4 pb-2 border-b border-neutral-200 flex items-center gap-2">
                <Wine className="h-5 w-5" />
                Wines
              </h3>
              <div>
                {wines.map((wine, i) => (
                  <WineItem
                    key={i}
                    wine={wine}
                    currency={currency}
                    lang={lang}
                    onAdd={addItem}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
