# Ralph Goals — Auth Flow & Landing Page
# Created: 2026-05-20
# Execute in order: G1 → G2 → G3 → G4 → G5 → G6

## How to use
Pick the first goal marked `[ ]`, complete it fully, mark it `[x]`, update CHECKPOINT.md, commit, then loop.
Never skip a goal. Never do two goals in one session unless both are trivially small (< 20 lines total).

---

## [ ] G1 — Landing page at `/`

**Goal:** Replace `HomePage.jsx` (currently an upload form) with a marketing landing page.

**Acceptance criteria:**
- `/` shows a hero section: headline "Digitalisez votre menu en 2 minutes", subline "Uploadez votre PDF — notre IA crée un menu QR scannable instantanément."
- 3 feature cards: "Menu QR interactif", "OCR IA automatique", "Analytics en temps réel"
- Primary CTA button: "Commencer gratuitement" → Clerk `<SignUpButton mode="modal">`
- Secondary link: "Se connecter" → Clerk `<SignInButton mode="modal">`
- If user is already `<SignedIn>`, show "Aller au tableau de bord" → `/dashboard` instead of the auth buttons
- No upload form on this page
- Style: black/white/neutral only, consistent with rest of app

**Files to change:**
- `frontend/src/pages/HomePage.jsx` — full rewrite

**Test:** `cd frontend && npx vitest run --reporter=dot` must pass (no HomePage unit tests to break)

---

## [ ] G2 — Auth-gate all restaurant routes

**Goal:** Unauthenticated users hitting protected routes are redirected to `/`.

**Acceptance criteria:**
- New file `frontend/src/components/RequireAuth.jsx` — renders children if `<SignedIn>`, renders `<Navigate to="/" replace />` if `<SignedOut>`
- The following routes in `App.jsx` are wrapped with `<RequireAuth>`:
  - `/upload`
  - `/dashboard` and `/dashboard/:slug`
  - `/restaurant/dashboard`
  - `/restaurant/:slug/settings`
  - `/restaurant/subscription`
  - `/onboarding`
  - `/analytics`
  - `/admin`
  - `/menus/:menuId/edit`
  - `/menus/:menuId/translate`
  - `/tables/:menuSlug`
- Public routes NOT wrapped (keep accessible without login):
  - `/` (landing)
  - `/menu/:slug` and all `/menu/:slug/*` (client-facing QR menu)
  - `/kds/:slug` (kitchen screen — has its own token auth)

**Files to change:**
- `frontend/src/App.jsx`
- new `frontend/src/components/RequireAuth.jsx`

**Test:** `cd frontend && npx vitest run --reporter=dot` must pass

---

## [ ] G3 — Post-login redirect (new user → onboarding, returning → dashboard)

**Goal:** After Clerk sign-in, automatically route the user to the right place.

**Acceptance criteria:**
- New file `frontend/src/components/AuthRedirect.jsx`
- On mount (when user is `SignedIn`): call `GET /api/dashboard/menus` with Bearer token
- If response `menus` array is empty → `navigate('/onboarding', { replace: true })`
- If response has menus → `navigate('/dashboard', { replace: true })`
- Show a spinner while the check is in flight
- `HomePage.jsx` renders `<AuthRedirect />` when user is `<SignedIn>` (instead of the CTA buttons)

**Files to change:**
- new `frontend/src/components/AuthRedirect.jsx`
- `frontend/src/pages/HomePage.jsx` — add `<SignedIn><AuthRedirect /></SignedIn>` block

**Test:** `cd frontend && npx vitest run --reporter=dot` must pass

---

## [ ] G4 — Fix onboarding: use auth token + restaurant name from Step 1

**Goal:** Onboarding Step 2 currently uploads with a hardcoded name and no auth. Fix it.

**Acceptance criteria:**
- `OnboardingPage` passes `restaurantName` (from Step 1 data) and `getToken` function down to `StepMenu`
- `StepMenu.handleUpload` does: `const token = await getToken(); await api.uploadMenuAsync(restaurantName, file, token);`
- Remove the hardcoded `'Mon restaurant'` and `'fr,en'` strings from the upload call
- `StepMenu` receives props: `{ onNext, onBack, restaurantName, getToken }`
- Import `useAuth` from `@clerk/clerk-react` in `OnboardingPage` and extract `getToken`

**Files to change:**
- `frontend/src/features/restaurant/OnboardingPage.jsx`

**Test:** `cd frontend && npx vitest run --reporter=dot` must pass

---

## [ ] G5 — Backend: save RestaurantProfile on onboarding complete

**Goal:** `POST /api/v1/restaurants/onboarding/complete` must be auth-gated and upsert a `RestaurantProfile` row.

**Acceptance criteria:**
- Endpoint requires `require_authenticated_user` dependency
- On call: upsert `RestaurantProfile` where `slug` = slugified `restaurant_name`, set `name`, `owner_email` = `user["email"]`
- If a `RestaurantProfile` with that slug already exists for this user, update `name` only (don't overwrite other fields)
- Return `{"status": "ok", "slug": "<slug>"}`
- Slug generation: lowercase, replace spaces/special chars with `-`, strip leading/trailing `-`

**Files to change:**
- Find the router that has this endpoint (`grep -r "onboarding/complete" backend/app/routers/`) and edit it
- If the endpoint doesn't exist, create it in `backend/app/routers/restaurants.py`

**Test:** `cd backend && .venv/bin/python -m pytest tests/ -q --tb=short -k "onboarding or profile"` must pass
Add a test for the endpoint if none exists.

---

## [ ] G6 — Dashboard empty state with CTA to onboarding

**Goal:** A user with zero menus sees a helpful empty state instead of a blank list.

**Acceptance criteria:**
- In `DashboardPage.jsx`, when `menus.length === 0` and loading is done, render an empty state:
  - Icon: `QrCode` from lucide-react
  - Heading: "Aucun menu pour l'instant"
  - Subtext: "Importez votre carte PDF et notre IA crée votre menu digital en quelques minutes."
  - Button: "Créer mon premier menu" → `navigate('/onboarding')`
- The existing list rendering is unchanged when `menus.length > 0`

**Files to change:**
- `frontend/src/features/restaurant/DashboardPage.jsx`

**Test:** `cd frontend && npx vitest run --reporter=dot` must pass

---

## Completion checklist

- [ ] G1 Landing page
- [ ] G2 Auth-gate routes
- [ ] G3 Post-login redirect
- [ ] G4 Onboarding auth fix
- [ ] G5 Backend profile upsert
- [ ] G6 Dashboard empty state

When all 6 are checked, update `.ralph/CHECKPOINT.md` to move all items to Done and set NEXT to "E2E smoke test of full auth flow".
