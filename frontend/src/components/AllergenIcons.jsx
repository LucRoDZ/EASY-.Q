/**
 * AllergenIcons — 14 EU-mandated allergen icons (Directive 2003/89/EC)
 *
 * Usage:
 *   <AllergenIcons allergens={['gluten', 'lactose', 'oeufs']} />
 *
 * Each icon is a small SVG circle with tooltip on hover.
 */

const ALLERGENS = {
  gluten: {
    label: 'Gluten',
    abbr: 'GL',
    title: 'Gluten (céréales)',
    path: 'M12 3C7 3 3 7 3 12s4 9 9 9 9-4 9-9-4-9-9-9zm-1 13V8l5 4-5 4z',
  },
  crustaces: {
    label: 'Crustacés',
    abbr: 'CR',
    title: 'Crustacés',
    path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l7 4.5-7 4.5z',
  },
  oeufs: {
    label: 'Œufs',
    abbr: 'OE',
    title: 'Œufs',
    path: 'M12 2a8 8 0 00-8 8c0 5.25 4 10 8 12 4-2 8-6.75 8-12a8 8 0 00-8-8z',
  },
  poisson: {
    label: 'Poisson',
    abbr: 'PO',
    title: 'Poisson',
    path: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm4.24 16L12 15.45 7.77 18l1.12-4.81-3.73-3.23 4.92-.42L12 5l1.92 4.53 4.92.42-3.73 3.23L16.23 18z',
  },
  arachides: {
    label: 'Arachides',
    abbr: 'AR',
    title: 'Arachides (cacahuètes)',
    path: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  },
  soja: {
    label: 'Soja',
    abbr: 'SO',
    title: 'Soja',
    path: 'M17 8C8 10 5.9 16.17 3.82 22H5.71c.19-.53.39-1.05.59-1.55C7.87 17.82 10.41 16 14 16h3V8z',
  },
  lactose: {
    label: 'Lait',
    abbr: 'LA',
    title: 'Lait / Lactose',
    path: 'M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2V3zm-4 7H8V5h8v5z',
  },
  fruits_coque: {
    label: 'Fruits à coque',
    abbr: 'FC',
    title: 'Fruits à coque (noix, amandes…)',
    path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
  },
  celeri: {
    label: 'Céleri',
    abbr: 'CE',
    title: 'Céleri',
    path: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
  },
  moutarde: {
    label: 'Moutarde',
    abbr: 'MO',
    title: 'Moutarde',
    path: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z',
  },
  sesame: {
    label: 'Sésame',
    abbr: 'SE',
    title: 'Graines de sésame',
    path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
  },
  sulfites: {
    label: 'Sulfites',
    abbr: 'SU',
    title: 'Anhydride sulfureux / Sulfites',
    path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
  },
  lupin: {
    label: 'Lupin',
    abbr: 'LU',
    title: 'Lupin',
    path: 'M12 2l-5.5 9h11L12 2zm0 3.84L14.93 10H9.07L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM4.5 17h7v2h-7z',
  },
  mollusques: {
    label: 'Mollusques',
    abbr: 'ML',
    title: 'Mollusques',
    path: 'M22 9V7h-2V5c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2v-2h-2V9h2zm-4 10H4V5h14v14z',
  },
};

// ─── Single icon ──────────────────────────────────────────────────────────────

function AllergenIcon({ code }) {
  const info = ALLERGENS[code];
  if (!info) return null;

  return (
    <span
      title={info.title}
      aria-label={info.title}
      className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-neutral-800 text-white shrink-0 cursor-help"
      style={{ fontSize: '7px', fontWeight: 700, letterSpacing: 0 }}
    >
      {info.abbr}
    </span>
  );
}

// ─── Icon group ───────────────────────────────────────────────────────────────

export default function AllergenIcons({ allergens = [] }) {
  if (!allergens || allergens.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1.5" role="list" aria-label="Allergènes">
      {allergens.map((code) => (
        <AllergenIcon key={code} code={code} />
      ))}
    </div>
  );
}

export { ALLERGENS };
