import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Loader2, Plus, Save, Eye, AlertCircle, CheckCircle2,
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { api } from '../../api';
import SectionCard, { SortableSection, newSection } from './SectionCard';

// ─── Constants ────────────────────────────────────────────────────────────────

const AUTOSAVE_DELAY = 2000; // 2 seconds

// ─── Small helpers ─────────────────────────────────────────────────────────────

function ensureIds(sections) {
  return sections.map((s) => ({
    ...s,
    id: s.id || crypto.randomUUID(),
    items: (s.items || []).map((it) => ({ ...it, id: it.id || crypto.randomUUID() })),
  }));
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
