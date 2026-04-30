import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CartProvider } from '../context/CartContext';
import MenuView, { SearchFilterBar } from './MenuView';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SECTIONS = [
  {
    title: 'Entrées',
    items: [
      {
        name: 'Salade César',
        description: 'Laitue romaine, parmesan, croûtons',
        price: 12.5,
        allergens: ['gluten', 'lactose'],
        tags: ['maison'],
      },
      {
        name: 'Soupe du jour',
        description: '',
        price: 8,
        allergens: [],
        tags: ['végétarien'],
      },
    ],
  },
  {
    title: 'Plats',
    items: [
      {
        name: 'Boeuf bourguignon',
        description: 'Mijoté 6 heures, pommes de terre',
        price: 22,
        allergens: ['celeri'],
        tags: ['maison'],
      },
    ],
  },
];

const WINES = [
  { name: 'Bordeaux Rouge', type: 'rouge', region: 'Bordeaux', grape: 'Cabernet', price: 28 },
];

function renderMenuView(props = {}) {
  return render(
    <CartProvider>
      <MenuView
        sections={SECTIONS}
        wines={[]}
        currency="EUR"
        lang="fr"
        query=""
        activeFilters={[]}
        {...props}
      />
    </CartProvider>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MenuView — sections and items', () => {
  it('renders section titles', () => {
    renderMenuView();
    expect(screen.getByText('Entrées')).toBeInTheDocument();
    expect(screen.getByText('Plats')).toBeInTheDocument();
  });

  it('renders item names', () => {
    renderMenuView();
    expect(screen.getByText('Salade César')).toBeInTheDocument();
    expect(screen.getByText('Soupe du jour')).toBeInTheDocument();
    expect(screen.getByText('Boeuf bourguignon')).toBeInTheDocument();
  });

  it('renders item descriptions', () => {
    renderMenuView();
    expect(screen.getByText('Laitue romaine, parmesan, croûtons')).toBeInTheDocument();
    expect(screen.getByText('Mijoté 6 heures, pommes de terre')).toBeInTheDocument();
  });

  it('renders item prices formatted as currency', () => {
    renderMenuView();
    // formatPrice uses Intl — expect the number to appear somewhere
    expect(screen.getByText(/12[,.]50/)).toBeInTheDocument();
    expect(screen.getByText(/8[,.]00|8\s*€/)).toBeInTheDocument();
    expect(screen.getByText(/22[,.]00/)).toBeInTheDocument();
  });

  it('renders allergen icons for items with allergens', () => {
    renderMenuView();
    // AllergenIcons renders title attributes
    expect(screen.getByTitle('Gluten (céréales)')).toBeInTheDocument();
    expect(screen.getByTitle('Lait / Lactose')).toBeInTheDocument();
  });

  it('renders tags as pills', () => {
    renderMenuView();
    const maisonTags = screen.getAllByText('maison');
    expect(maisonTags.length).toBeGreaterThanOrEqual(1);
  });
});

describe('MenuView — wine section', () => {
  it('renders wine section when wines are provided', () => {
    renderMenuView({ wines: WINES });
    expect(screen.getByText('Bordeaux Rouge')).toBeInTheDocument();
  });

  it('does not render wine section when wines array is empty', () => {
    renderMenuView({ wines: [] });
    expect(screen.queryByText('Bordeaux Rouge')).not.toBeInTheDocument();
  });
});

describe('MenuView — item detail modal', () => {
  it('opens item detail modal on item click', async () => {
    const user = userEvent.setup();
    renderMenuView();

    const caesarEl = screen.getByText('Salade César');
    await user.click(caesarEl.closest('[class*="cursor-pointer"]') || caesarEl);

    // Modal should appear with the item name as a heading
    await waitFor(() => {
      const headings = screen.getAllByText('Salade César');
      expect(headings.length).toBeGreaterThan(1);
    });
  });

  it('closes modal when backdrop is clicked', async () => {
    const user = userEvent.setup();
    renderMenuView();

    // Open modal
    await user.click(screen.getByText('Salade César'));

    // The modal overlay has onClick to close
    const overlay = document.querySelector('.fixed.inset-0');
    if (overlay) {
      fireEvent.click(overlay);
      await waitFor(() => {
        const headings = screen.queryAllByText('Salade César');
        expect(headings.length).toBe(1); // only the list item remains
      });
    }
  });
});

describe('MenuView — add to cart', () => {
  it('shows add-to-cart button for each item', () => {
    renderMenuView();
    const addButtons = screen.getAllByText('Ajouter');
    expect(addButtons.length).toBe(3); // 3 items in SECTIONS
  });

  it('add button shows confirmation state briefly', async () => {
    const user = userEvent.setup();
    renderMenuView();

    const [firstAdd] = screen.getAllByText('Ajouter');
    await user.click(firstAdd);

    // Button should briefly show "Ajouté!" (translation includes !)
    await waitFor(() => expect(screen.getByText(/Ajouté/)).toBeInTheDocument());
  });
});

describe('MenuView — search filter', () => {
  it('shows empty state when no items match query', () => {
    renderMenuView({ query: 'xxxxxxnotfound' });
    expect(screen.getByText('Aucun plat ne correspond à votre recherche.')).toBeInTheDocument();
  });

  it('filters items by name query', () => {
    renderMenuView({ query: 'salade' });
    expect(screen.getByText('Salade César')).toBeInTheDocument();
    expect(screen.queryByText('Boeuf bourguignon')).not.toBeInTheDocument();
  });

  it('shows result count when filter is active', () => {
    renderMenuView({ query: 'salade' });
    expect(screen.getByText(/1 résultat/)).toBeInTheDocument();
  });

  it('filters by vegetarian diet filter', () => {
    renderMenuView({ activeFilters: ['vegetarian'] });
    expect(screen.getByText('Soupe du jour')).toBeInTheDocument();
    expect(screen.queryByText('Salade César')).not.toBeInTheDocument();
    expect(screen.queryByText('Boeuf bourguignon')).not.toBeInTheDocument();
  });

  it('filters out gluten items for gluten-free filter', () => {
    renderMenuView({ activeFilters: ['glutenfree'] });
    expect(screen.queryByText('Salade César')).not.toBeInTheDocument();
    // Soupe has no allergens — should appear
    expect(screen.getByText('Soupe du jour')).toBeInTheDocument();
  });
});

describe('SearchFilterBar', () => {
  it('renders search input', () => {
    render(
      <SearchFilterBar
        query=""
        onQueryChange={vi.fn()}
        activeFilters={[]}
        onToggleFilter={vi.fn()}
        lang="fr"
      />
    );
    expect(screen.getByPlaceholderText('Rechercher un plat…')).toBeInTheDocument();
  });

  it('calls onQueryChange when typing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SearchFilterBar
        query=""
        onQueryChange={onChange}
        activeFilters={[]}
        onToggleFilter={vi.fn()}
        lang="fr"
      />
    );
    await user.type(screen.getByPlaceholderText('Rechercher un plat…'), 's');
    expect(onChange).toHaveBeenCalledWith('s');
  });

  it('shows clear button when query is non-empty', () => {
    render(
      <SearchFilterBar
        query="salade"
        onQueryChange={vi.fn()}
        activeFilters={[]}
        onToggleFilter={vi.fn()}
        lang="fr"
      />
    );
    // The X clear button should be present
    const clearBtn = document.querySelector('button[class*="absolute"]');
    expect(clearBtn).toBeTruthy();
  });

  it('renders diet filter pills', () => {
    render(
      <SearchFilterBar
        query=""
        onQueryChange={vi.fn()}
        activeFilters={[]}
        onToggleFilter={vi.fn()}
        lang="fr"
      />
    );
    expect(screen.getByText('Végétarien')).toBeInTheDocument();
    expect(screen.getByText('Vegan')).toBeInTheDocument();
    expect(screen.getByText('Sans gluten')).toBeInTheDocument();
  });

  it('calls onToggleFilter when a filter pill is clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <SearchFilterBar
        query=""
        onQueryChange={vi.fn()}
        activeFilters={[]}
        onToggleFilter={onToggle}
        lang="fr"
      />
    );
    await user.click(screen.getByText('Végétarien'));
    expect(onToggle).toHaveBeenCalledWith('vegetarian');
  });

  it('highlights active filter pill', () => {
    render(
      <SearchFilterBar
        query=""
        onQueryChange={vi.fn()}
        activeFilters={['vegetarian']}
        onToggleFilter={vi.fn()}
        lang="fr"
      />
    );
    const pill = screen.getByText('Végétarien').closest('button');
    expect(pill.className).toContain('bg-neutral-900');
  });
});
