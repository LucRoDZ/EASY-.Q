import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Loader2, ChevronDown, ChevronRight, Plus, Trash2,
  Save, Eye, EyeOff, AlertCircle, CheckCircle2, GripVertical,
  Copy, Smartphone, Globe
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../../api';
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

const AUTOSAVE_DELAY = 2000; // 2 seconds

// ─── Small helpers ─────────────────────────────────────────────────────────────

function newItem() {
  return { id: crypto.randomUUID(), name: '', description: '', price: '', allergens: [], tags: [], is_available: true };
}

function newSection() {
  return { id: crypto.randomUUID(), title: 'Nouvelle section', items: [newItem()] };
}

function ensureIds(sections) {
  return sections.map((s) => ({
    ...s,
    id: s.id || crypto.randomUUID(),
    items: (s.items || []).map((it) => ({ ...it, id: it.id || crypto.randomUUID() })),
  }));
}

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

// ─── SortableItem (drag handle for items) ──────────────────────────────────────

function SortableItem({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {children(listeners)}
    </div>
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

// ─── SortableSection (drag handle for sections) ────────────────────────────────

function SortableSection({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {children(listeners)}
    </div>
  );
}

// ─── SectionCard ───────────────────────────────────────────────────────────────

function SectionCard({ section, onUpdate, onDelete, sectionDragListeners }) {
  const [expanded, setExpanded] = useState(true);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const updateItem = (itemId, updated) => {
    const items = section.items.map((it) => (it.id === itemId ? updated : it));
    onUpdate({ ...section, items });
  };

  const deleteItem = (itemId) => {
    const items = section.items.filter((it) => it.id !== itemId);
    onUpdate({ ...section, items });
  };

  const addItem = () => onUpdate({ ...section, items: [...section.items, newItem()] });

  const handleItemDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const oldIdx = section.items.findIndex((it) => it.id === active.id);
    const newIdx = section.items.findIndex((it) => it.id === over.id);
    onUpdate({ ...section, items: arrayMove(section.items, oldIdx, newIdx) });
  };

  const itemIds = section.items.map((it) => it.id);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-neutral-200">
      {/* Section header */}
      <div className="flex items-center gap-3 p-4 border-b border-neutral-100">
        <span
          {...sectionDragListeners}
          className="text-neutral-300 shrink-0 cursor-grab active:cursor-grabbing touch-none"
          aria-label="Déplacer la section"
        >
          <GripVertical className="h-4 w-4" />
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-neutral-400 hover:text-neutral-600"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <input
          className="flex-1 text-sm font-semibold text-neutral-900 bg-transparent border-0 focus:outline-none focus:ring-0 placeholder:text-neutral-400"
          placeholder="Nom de la section"
          value={section.title}
          onChange={(e) => onUpdate({ ...section, title: e.target.value })}
        />
        <span className="text-xs text-neutral-400 shrink-0">
          {section.items.length} plat{section.items.length !== 1 ? 's' : ''}
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="text-neutral-300 hover:text-red-400 shrink-0"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Items */}
      {expanded && (
        <div className="px-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleItemDragEnd}
          >
            <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
              {section.items.map((item) => (
                <SortableItem key={item.id} id={item.id}>
                  {(listeners) => (
                    <MenuItemRow
                      item={item}
                      onUpdate={(updated) => updateItem(item.id, updated)}
                      onDelete={() => deleteItem(item.id)}
                      dragListeners={listeners}
                    />
                  )}
                </SortableItem>
              ))}
            </SortableContext>
          </DndContext>

          <button
            type="button"
            onClick={addItem}
            className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-700 py-3 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Ajouter un plat
          </button>
        </div>
      )}
    </div>
  );
}

// ─── MobilePreview ─────────────────────────────────────────────────────────────

function MobilePreview({ restaurantName, sections }) {
  return (
    <div className="flex flex-col items-center">
      {/* Phone frame */}
      <div className="relative w-[280px] bg-white rounded-[2rem] border-4 border-neutral-800 shadow-2xl overflow-hidden">
        {/* Status bar */}
        <div className="bg-neutral-900 px-4 py-1.5 flex justify-between items-center">
          <span className="text-[10px] text-white font-medium">9:41</span>
          <div className="flex gap-1">
            <span className="w-3 h-1.5 bg-white rounded-sm opacity-80" />
            <span className="w-1 h-1.5 bg-white rounded-sm opacity-60" />
          </div>
        </div>

        {/* Menu header */}
        <div className="bg-black text-white px-4 py-3 sticky top-0">
          <h1 className="text-sm font-bold truncate">{restaurantName || 'Restaurant'}</h1>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto max-h-[480px] bg-neutral-50">
          {sections.length === 0 ? (
            <p className="text-center text-neutral-400 text-xs p-6">Aucun plat ajouté</p>
          ) : (
            sections.map((section) => (
              <div key={section.id} className="mb-2">
                <div className="bg-neutral-100 px-4 py-2">
                  <h2 className="text-xs font-semibold text-neutral-700 uppercase tracking-wide">
                    {section.title || 'Section'}
                  </h2>
                </div>
                {section.items.filter((it) => it.is_available !== false).map((item) => (
                  <div
                    key={item.id}
                    className="flex justify-between items-start px-4 py-2.5 border-b border-neutral-100 bg-white"
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      <p className="text-xs font-medium text-neutral-900 truncate">{item.name || '—'}</p>
                      {item.description && (
                        <p className="text-[10px] text-neutral-500 mt-0.5 line-clamp-2">{item.description}</p>
                      )}
                    </div>
                    {item.price !== '' && item.price !== undefined && item.price !== null && (
                      <span className="text-xs font-semibold text-neutral-900 shrink-0 tabular-nums">
                        {typeof item.price === 'number' ? `${item.price.toFixed(2)} €` : `${item.price} €`}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Home bar */}
        <div className="bg-white px-4 py-2 flex justify-center">
          <div className="w-20 h-1 bg-neutral-800 rounded-full" />
        </div>
      </div>
      <p className="text-xs text-neutral-400 mt-3">Aperçu mobile</p>
    </div>
  );
}

// ─── MenuEditorPage ────────────────────────────────────────────────────────────

export default function MenuEditorPage() {
  const { menuId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [restaurantName, setRestaurantName] = useState('');
  const [slug, setSlug] = useState('');
  const [sections, setSections] = useState([]);
  const [wines, setWines] = useState([]);
  const [publishStatus, setPublishStatus] = useState('draft'); // 'draft' | 'published'

  const [saveStatus, setSaveStatus] = useState('saved'); // 'saved' | 'modified' | 'saving' | 'error'
  const [publishing, setPublishing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const saveTimer = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    api.getMenuById(menuId)
      .then((data) => {
        setRestaurantName(data.restaurant_name || '');
        setSlug(data.slug || '');
        setSections(ensureIds(data.sections || []));
        setWines(data.wines || []);
        setPublishStatus(data.publish_status || 'draft');
      })
      .catch((err) => setLoadError(err.message || 'Impossible de charger le menu'))
      .finally(() => setLoading(false));
  }, [menuId]);

  // ── Auto-save ─────────────────────────────────────────────────────────────

  const doSave = useCallback(
    async (name, secs, ws) => {
      setSaveStatus('saving');
      try {
        await api.updateMenu(menuId, {
          restaurant_name: name,
          sections: secs,
          wines: ws,
        });
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }
    },
    [menuId],
  );

  const scheduleAutoSave = useCallback(
    (name, secs, ws) => {
      setSaveStatus('modified');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => doSave(name, secs, ws), AUTOSAVE_DELAY);
    },
    [doSave],
  );

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const updateSection = (sectionId, updated) => {
    const next = sections.map((s) => (s.id === sectionId ? updated : s));
    setSections(next);
    scheduleAutoSave(restaurantName, next, wines);
  };

  const deleteSection = (sectionId) => {
    const next = sections.filter((s) => s.id !== sectionId);
    setSections(next);
    scheduleAutoSave(restaurantName, next, wines);
  };

  const addSection = () => {
    const next = [...sections, newSection()];
    setSections(next);
    scheduleAutoSave(restaurantName, next, wines);
  };

  const handleSectionDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const oldIdx = sections.findIndex((s) => s.id === active.id);
    const newIdx = sections.findIndex((s) => s.id === over.id);
    const next = arrayMove(sections, oldIdx, newIdx);
    setSections(next);
    scheduleAutoSave(restaurantName, next, wines);
  };

  const handleNameChange = (val) => {
    setRestaurantName(val);
    scheduleAutoSave(val, sections, wines);
  };

  const handleSaveNow = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    doSave(restaurantName, sections, wines);
  };

  const handlePublishToggle = async () => {
    setPublishing(true);
    try {
      const next = publishStatus === 'published' ? 'draft' : 'published';
      await api.publishMenu(menuId, next);
      setPublishStatus(next);
    } catch {
      // silently ignore — user can retry
    } finally {
      setPublishing(false);
    }
  };

  const handleDuplicate = async () => {
    setDuplicating(true);
    try {
      const result = await api.duplicateMenu(menuId);
      navigate(`/menus/${result.menu_id}/edit`);
    } catch {
      setDuplicating(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="flex items-center gap-2 text-red-500">
          <AlertCircle className="h-5 w-5" />
          {loadError}
        </div>
      </div>
    );
  }

  const sectionIds = sections.map((s) => s.id);

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <input
              className="text-sm font-semibold bg-transparent border-0 focus:outline-none focus:ring-0 text-white placeholder:text-neutral-400 truncate"
              value={restaurantName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Nom du restaurant"
            />
            {/* Publish status badge */}
            <span
              className={[
                'hidden sm:inline-flex shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide',
                publishStatus === 'published'
                  ? 'bg-green-500/20 text-green-300'
                  : 'bg-neutral-700 text-neutral-400',
              ].join(' ')}
            >
              {publishStatus === 'published' ? 'Publié' : 'Brouillon'}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {/* Save indicator */}
            <span className="text-xs text-neutral-400 hidden sm:flex items-center">
              {saveStatus === 'saving' && (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Sauvegarde…
                </span>
              )}
              {saveStatus === 'modified' && 'Non sauvegardé'}
              {saveStatus === 'saved' && (
                <span className="flex items-center gap-1 text-neutral-300">
                  <CheckCircle2 className="h-3 w-3" /> Sauvegardé
                </span>
              )}
              {saveStatus === 'error' && (
                <span className="text-red-400 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> Erreur
                </span>
              )}
            </span>

            {/* Preview toggle */}
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className={[
                'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full transition-colors',
                showPreview
                  ? 'bg-white text-black hover:bg-neutral-100'
                  : 'bg-white/10 hover:bg-white/20 text-white',
              ].join(' ')}
              title="Aperçu mobile"
            >
              <Smartphone className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Aperçu</span>
            </button>

            {/* Save */}
            <button
              type="button"
              onClick={handleSaveNow}
              disabled={saveStatus === 'saving' || saveStatus === 'saved'}
              className="flex items-center gap-1.5 text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-full transition-colors disabled:opacity-40"
            >
              <Save className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sauvegarder</span>
            </button>

            {/* Duplicate */}
            <button
              type="button"
              onClick={handleDuplicate}
              disabled={duplicating}
              className="flex items-center gap-1.5 text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-full transition-colors disabled:opacity-40"
              title="Dupliquer le menu"
            >
              {duplicating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">Dupliquer</span>
            </button>

            {/* Publish toggle */}
            <button
              type="button"
              onClick={handlePublishToggle}
              disabled={publishing}
              className={[
                'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full transition-colors disabled:opacity-40',
                publishStatus === 'published'
                  ? 'bg-green-500 text-white hover:bg-green-600'
                  : 'bg-white text-black hover:bg-neutral-100',
              ].join(' ')}
            >
              {publishing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Globe className="h-3.5 w-3.5" />
              )}
              {publishStatus === 'published' ? 'Dépublier' : 'Publier'}
            </button>

            {slug && (
              <Link
                to={`/menu/${slug}`}
                target="_blank"
                className="flex items-center gap-1.5 text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-full transition-colors"
              >
                <Eye className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Voir</span>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Content + Preview */}
      <div className={['max-w-7xl mx-auto px-4 py-8', showPreview ? 'flex gap-8 items-start' : ''].join(' ')}>
        {/* Editor */}
        <main className={['space-y-4', showPreview ? 'flex-1 min-w-0' : 'max-w-3xl mx-auto w-full'].join(' ')}>
          {sections.length === 0 && (
            <div className="bg-white rounded-xl border border-neutral-200 p-8 text-center text-neutral-400 text-sm">
              Aucune section. Ajoutez-en une ci-dessous.
            </div>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleSectionDragEnd}
          >
            <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
              {sections.map((section) => (
                <SortableSection key={section.id} id={section.id}>
                  {(listeners) => (
                    <SectionCard
                      section={section}
                      onUpdate={(updated) => updateSection(section.id, updated)}
                      onDelete={() => deleteSection(section.id)}
                      sectionDragListeners={listeners}
                    />
                  )}
                </SortableSection>
              ))}
            </SortableContext>
          </DndContext>

          <button
            type="button"
            onClick={addSection}
            className="flex items-center gap-2 bg-black text-white rounded-full px-5 py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Ajouter une section
          </button>
        </main>

        {/* Mobile preview panel */}
        {showPreview && (
          <aside className="hidden lg:block shrink-0 sticky top-20">
            <MobilePreview restaurantName={restaurantName} sections={sections} />
          </aside>
        )}
      </div>
    </div>
  );
}
