import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MenuEditorPage from './MenuEditorPage';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../api', () => ({
  api: {
    getMenuById: vi.fn(),
    updateMenu: vi.fn(),
  },
}));

// dnd-kit uses pointer/touch events that aren't available in jsdom — stub out
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    DndContext: ({ children }) => <div>{children}</div>,
    useSensor: () => ({}),
    useSensors: () => [],
    PointerSensor: class {},
    KeyboardSensor: class {},
    closestCenter: () => null,
  };
});

vi.mock('@dnd-kit/sortable', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    SortableContext: ({ children }) => <div>{children}</div>,
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      transition: null,
      isDragging: false,
    }),
    sortableKeyboardCoordinates: () => {},
    verticalListSortingStrategy: 'vertical',
    arrayMove: actual.arrayMove,
  };
});

import { api } from '../../api';

// ─── Helper ───────────────────────────────────────────────────────────────────

const MENU_DATA = {
  menu_id: 1,
  slug: 'le-bistrot',
  restaurant_name: 'Le Bistrot',
  status: 'ready',
  sections: [
    {
      id: 'sec-1',
      title: 'Entrées',
      items: [
        { id: 'item-1', name: 'Salade César', description: 'Fraîche', price: 12.5, allergens: ['gluten', 'lactose'], tags: ['maison'], is_available: true },
        { id: 'item-2', name: 'Soupe', description: '', price: 8, allergens: [], tags: [], is_available: true },
      ],
    },
    {
      id: 'sec-2',
      title: 'Plats',
      items: [
        { id: 'item-3', name: 'Boeuf bourguignon', description: 'Mijoté', price: 22, allergens: [], tags: ['maison'], is_available: true },
      ],
    },
  ],
  wines: [],
  languages: 'fr,en',
};

function renderEditor() {
  api.getMenuById.mockResolvedValue(MENU_DATA);
  api.updateMenu.mockResolvedValue({ menu_id: 1, slug: 'le-bistrot' });

  return render(
    <MemoryRouter initialEntries={['/menus/1/edit']}>
      <Routes>
        <Route path="/menus/:menuId/edit" element={<MenuEditorPage />} />
      </Routes>
    </MemoryRouter>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MenuEditorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading spinner initially', () => {
    api.getMenuById.mockReturnValue(new Promise(() => {})); // never resolves
    render(
      <MemoryRouter initialEntries={['/menus/1/edit']}>
        <Routes>
          <Route path="/menus/:menuId/edit" element={<MenuEditorPage />} />
        </Routes>
      </MemoryRouter>
    );
    // There's an animated spinner
    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });

  it('renders restaurant name and sections after load', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByDisplayValue('Le Bistrot')).toBeInTheDocument());
    expect(screen.getByDisplayValue('Entrées')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Plats')).toBeInTheDocument();
  });

  it('shows items inside sections', async () => {
    renderEditor();
    await waitFor(() => screen.getByDisplayValue('Salade César'));
    expect(screen.getByDisplayValue('Soupe')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Boeuf bourguignon')).toBeInTheDocument();
  });

  it('displays price for each item', async () => {
    renderEditor();
    await waitFor(() => screen.getByDisplayValue('12.5'));
    expect(screen.getByDisplayValue('8')).toBeInTheDocument();
    expect(screen.getByDisplayValue('22')).toBeInTheDocument();
  });

  it('shows allergen icons for items that have allergens', async () => {
    renderEditor();
    await waitFor(() => screen.getByDisplayValue('Salade César'));
    // AllergenIcons renders abbreviation spans — GL for gluten, LA for lactose
    expect(screen.getByTitle('Gluten (céréales)')).toBeInTheDocument();
    expect(screen.getByTitle('Lait / Lactose')).toBeInTheDocument();
  });

  it('can add a new section', async () => {
    const user = userEvent.setup();
    renderEditor();
    await waitFor(() => screen.getByDisplayValue('Entrées'));

    await user.click(screen.getByText('Ajouter une section'));
    expect(screen.getByDisplayValue('Nouvelle section')).toBeInTheDocument();
  });

  it('can edit section title', async () => {
    const user = userEvent.setup();
    renderEditor();
    await waitFor(() => screen.getByDisplayValue('Entrées'));

    const input = screen.getByDisplayValue('Entrées');
    await user.clear(input);
    await user.type(input, 'Starters');
    expect(screen.getByDisplayValue('Starters')).toBeInTheDocument();
  });

  it('can delete a section', async () => {
    const user = userEvent.setup();
    renderEditor();
    await waitFor(() => screen.getByDisplayValue('Plats'));

    // Find the delete button for the "Plats" section — it's the Trash2 icon button
    // Sections appear in order, so the 2nd delete button is for "Plats"
    const deleteButtons = screen.getAllByRole('button', { name: '' }).filter(
      (btn) => btn.querySelector('svg')
    );
    // Click the delete button associated with the Plats section header
    const platsInput = screen.getByDisplayValue('Plats');
    const sectionHeader = platsInput.closest('div');
    const trashBtn = sectionHeader.querySelector('button:last-child');
    await user.click(trashBtn);

    await waitFor(() => expect(screen.queryByDisplayValue('Plats')).not.toBeInTheDocument());
  });

  it('can add an item to a section', async () => {
    const user = userEvent.setup();
    renderEditor();
    await waitFor(() => screen.getAllByText('Ajouter un plat'));

    const addButtons = screen.getAllByText('Ajouter un plat');
    await user.click(addButtons[0]); // first section

    const placeholders = screen.getAllByPlaceholderText('Nom du plat');
    // There were 2 items in section 1, now there should be 3 (one empty)
    expect(placeholders.length).toBeGreaterThan(2);
  });

  it('expands item row to show allergen toggles', async () => {
    const user = userEvent.setup();
    renderEditor();
    await waitFor(() => screen.getByDisplayValue('Salade César'));

    // Find the Salade César item row flex container and click its expand button
    const caesarInput = screen.getByDisplayValue('Salade César');
    const flexRow = caesarInput.parentElement;
    const [expandBtn] = flexRow.querySelectorAll('button');
    await user.click(expandBtn);

    expect(screen.getByText('Allergènes')).toBeInTheDocument();
    expect(screen.getByText('Tags')).toBeInTheDocument();
  });

  it('toggles allergen on an item', async () => {
    const user = userEvent.setup();
    renderEditor();
    await waitFor(() => screen.getByDisplayValue('Soupe'));

    // Expand Soupe via its flex row expand button
    const soupeInput = screen.getByDisplayValue('Soupe');
    const flexRow = soupeInput.parentElement;
    const [expandBtn] = flexRow.querySelectorAll('button');
    await user.click(expandBtn);

    // Click "gluten" allergen pill (first one found in the expanded section)
    const glutenPill = screen.getAllByText('gluten')[0];
    await user.click(glutenPill);

    // gluten pill should now be active (bg-neutral-800)
    expect(glutenPill.closest('button').className).toContain('bg-neutral-800');
  });

  it('toggles a tag on an item', async () => {
    const user = userEvent.setup();
    renderEditor();
    await waitFor(() => screen.getByDisplayValue('Soupe'));

    const soupeInput = screen.getByDisplayValue('Soupe');
    const flexRow = soupeInput.parentElement;
    const [expandBtn] = flexRow.querySelectorAll('button');
    await user.click(expandBtn);

    const vegeTag = screen.getAllByText('vegetarien')[0];
    await user.click(vegeTag);
    expect(vegeTag.closest('button').className).toContain('bg-neutral-800');
  });

  it('shows an error message on load failure', async () => {
    api.getMenuById.mockRejectedValue(new Error('Network error'));
    render(
      <MemoryRouter initialEntries={['/menus/1/edit']}>
        <Routes>
          <Route path="/menus/:menuId/edit" element={<MenuEditorPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText('Network error'));
  });

  it('calls updateMenu on save button click', async () => {
    const user = userEvent.setup();
    renderEditor();
    await waitFor(() => screen.getByDisplayValue('Le Bistrot'));

    // Modify something to enable the save button
    const nameInput = screen.getByDisplayValue('Le Bistrot');
    await user.clear(nameInput);
    await user.type(nameInput, 'Nouveau Nom');

    const saveBtn = screen.getByText('Sauvegarder');
    // Button may still be in "modified" state — click it
    fireEvent.click(saveBtn);

    await waitFor(() => expect(api.updateMenu).toHaveBeenCalled());
  });

  it('displays "Voir" link with menu slug', async () => {
    renderEditor();
    await waitFor(() => screen.getByText('Voir'));
    const link = screen.getByText('Voir').closest('a');
    expect(link.href).toContain('/menu/le-bistrot');
  });
});
