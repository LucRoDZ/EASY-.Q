import { useState, memo } from 'react';
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
import { GripVertical, ChevronDown, ChevronRight, Trash2, Plus } from 'lucide-react';
import MenuItemRow from './MenuItemRow';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function newItem() {
  return { id: crypto.randomUUID(), name: '', description: '', price: '', allergens: [], tags: [], is_available: true };
}

export function newSection() {
  return { id: crypto.randomUUID(), title: 'Nouvelle section', items: [newItem()] };
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

// ─── SortableSection (drag handle for sections) ────────────────────────────────

export function SortableSection({ id, children }) {
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

function SectionCard({ section, onUpdate, onDelete, onUploadItemImage, sectionDragListeners }) {
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
    <div className="bg-white dark:bg-neutral-800 rounded-xl shadow-sm border border-neutral-200 dark:border-neutral-700">
      {/* Section header */}
      <div className="flex items-center gap-3 p-4 border-b border-neutral-100 dark:border-neutral-700">
        <span
          {...sectionDragListeners}
          className="text-neutral-300 dark:text-neutral-600 shrink-0 cursor-grab active:cursor-grabbing touch-none"
          aria-label="Déplacer la section"
        >
          <GripVertical className="h-4 w-4" />
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <input
          className="flex-1 text-sm font-semibold text-neutral-900 dark:text-white bg-transparent border-0 focus:outline-none focus:ring-0 placeholder:text-neutral-400"
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
                      onUploadImage={onUploadItemImage ? (file) => onUploadItemImage(item.id, file) : null}
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

export default memo(SectionCard);
