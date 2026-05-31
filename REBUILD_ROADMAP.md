# EASY.Q — Roadmap de Rebuild Complète

> Document de référence · Généré le 2026-04-06  
> Basé sur : analyse du codebase MVP (Cresco-), codebase EASY.Q actuel, board Trello complet, best practices SaaS restaurant

---

## Table des matières

1. [Vision & Positionnement](#1-vision--positionnement)
2. [Ce qui existe déjà (État actuel)](#2-ce-qui-existe-déjà-état-actuel)
3. [Architecture technique cible](#3-architecture-technique-cible)
4. [Phase 0 — Fondations](#4-phase-0--fondations)
5. [Phase 1 — Parcours Restaurateur](#5-phase-1--parcours-restaurateur)
6. [Phase 2 — Parcours Client (Menu Digital)](#6-phase-2--parcours-client-menu-digital)
7. [Phase 3 — Paiement à Table](#7-phase-3--paiement-à-table)
8. [Phase 4 — Commande à Table (KDS)](#8-phase-4--commande-à-table-kds)
9. [Phase 5 — Analytics & Admin](#9-phase-5--analytics--admin)
10. [Phase 6 — Croissance & Monétisation](#10-phase-6--croissance--monétisation)
11. [Améliorations transversales](#11-améliorations-transversales)
12. [Tests & Qualité](#12-tests--qualité)
13. [CI/CD & Déploiement](#13-cicd--déploiement)
14. [Sécurité & RGPD](#14-sécurité--rgpd)
15. [Performance & Monitoring](#15-performance--monitoring)
16. [Modèle économique](#16-modèle-économique)
17. [Récapitulatif des priorités](#17-récapitulatif-des-priorités)

---

## 1. Vision & Positionnement

### Proposition de valeur
EASY.Q est un **SaaS restaurant tout-en-un** qui remplace à la fois :
- La carte papier → menu digital QR code (PWA, sans app)
- Le serveur pour les informations → chatbot IA Gemini (streaming SSE)
- Le terminal de paiement → Stripe Elements + Apple/Google Pay
- Le bon de commande papier → KDS temps réel (WebSocket)

**Différenciateur clé vs Sunday, Tipser, Zelty** : l'IA est intégrée dans le flux de commande ET de conseil, pas juste dans un chatbot décoratif.

### Cible
- **B2B** : Restaurants indépendants et groupes (5–100 tables), France d'abord, Europe ensuite
- **B2C** : Clients du restaurant (aucune friction — aucune app, aucun compte requis)

### Modèle
- **Freemium** : 1 menu, sans paiement en ligne
- **Pro (49€/mois)** : menus illimités + paiement Stripe + analytics + avis Google
- **Commission** : 0.5% sur chaque transaction paiement (en sus des frais Stripe)

---

## 2. Ce qui existe déjà (État actuel)

### ✅ Fait (Trello "Done" + MVP codebase à migrer)

| Composant | Détail |
|-----------|--------|
| Auth Clerk | magic link + social, JWT JWKS, auto-provision User |
| DB PostgreSQL | SQLAlchemy async, Alembic, modèles User/Restaurant/Menu/Table/Order/Payment |
| Routing frontend | `/` landing, `/pro/*` restaurateur, `/:slug` client (Phase 2) |
| Onboarding restaurateur | formulaire création restaurant, slug auto-généré |
| Admin backoffice | stats + liste users + toggle actif |
| i18n FR/EN/ES | `src/localization/translations.js` ✓ — réutilisable tel quel |
| Cookie banner CNIL | consentement nécessaire/analytics, conforme RGPD |
| CGU + Politique de confidentialité | pages légales |
| Rate limiting | slowapi, 60 req/min par IP |
| Security headers | X-Frame-Options, HSTS, nosniff |
| Tests unitaires | vitest, 21 tests routing + consent banner |

**Composants MVP à migrer** dans `src/features/` lors du rebuild :

| Fichier MVP actuel | Destination cible | Notes |
|--------------------|-------------------|-------|
| `src/pages/MenuPage.jsx` | `src/features/client/MenuPage.jsx` | Ajouter AllergenIcons + CartSummaryBar |
| `src/pages/CartPage.jsx` | `src/features/client/CartPage.jsx` | Enrichir (notes par item, TVA) |
| `src/components/ChatWidget.jsx` | `src/features/client/ChatWidget.jsx` | FAB corrigé bg-black ✓ |
| `src/components/MenuView.jsx` | `src/features/client/MenuView.jsx` | Conserver tel quel |
| `src/context/CartContext.jsx` | `src/contexts/CartContext.jsx` | Ajouter BroadcastChannel + restaurantId |
| `src/components/LanguageSelector.jsx` | `src/components/LanguageSelector.jsx` | Conserver tel quel |

### ❌ Manquant (à construire)

Tout le reste : OCR, éditeur de menu, QR codes, chatbot IA, paiement, KDS, analytics, etc.  
→ Voir phases 1 à 6 ci-dessous.

---

## 3. Architecture technique cible

### Vue d'ensemble

```
┌─────────────────────────────────────────────────────────┐
│                     FRONTEND (Vite + React 18)           │
│  /            Landing page (public)                      │
│  /pro/*       Espace restaurateur (Clerk auth)           │
│  /id_restaurant/:slug  Menu client (PWA, sans auth)      │
│  /pro/kds     KDS cuisine (WebSocket, auth tablette)     │
└──────────────────┬──────────────────────────────────────┘
                   │ REST + SSE + WebSocket
┌──────────────────▼──────────────────────────────────────┐
│              BACKEND (FastAPI async Python 3.12)         │
│  /api/v1/auth          Clerk webhook + /me               │
│  /api/v1/restaurants   CRUD + onboarding                 │
│  /api/v1/menus         CRUD menus + OCR + traduction     │
│  /api/v1/tables        CRUD tables + QR generation       │
│  /api/v1/chat          SSE streaming Gemini              │
│  /api/v1/orders        Commandes + KDS WebSocket         │
│  /api/v1/payments      Stripe intents + webhooks         │
│  /api/v1/analytics     Métriques restaurateur            │
│  /api/v1/admin         Superadmin                        │
└──────────────────┬──────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
  PostgreSQL             Redis (cache + sessions)
  (données)              (rate limit, pub/sub KDS)
```

### Stack technique

| Couche | Technologie | Raison |
|--------|-------------|--------|
| Frontend | React 18 + Vite + Tailwind CSS | PWA mobile-first, build rapide |
| Auth | Clerk | magic link, social, session management |
| Backend | FastAPI async + Python 3.12 | performance async, typage Pydantic |
| ORM | SQLAlchemy 2.0 async + Alembic | migrations versionnées |
| DB | PostgreSQL 16 | JSONB pour traductions, full-text search |
| Cache | Redis 7 | sessions chatbot, rate limit, pub/sub KDS |
| IA OCR | Gemini 2.5 Flash Vision | extraction PDF → JSON structuré |
| IA Chatbot | Gemini 2.5 Flash | streaming SSE, contexte menu |
| Paiement | Stripe (Elements + Connect + Billing) | PCI-DSS, conformité DSP2 |
| Email | Resend | templates HTML, tracking |
| File storage | Cloudflare R2 (ou S3) | PDFs, logos, QR codes |
| Hosting | Railway (EU) ou Scalingo | RGPD, hébergement France |
| Monitoring | Sentry + PostHog (RGPD) | erreurs + analytics produit |

### Améliorations architecturales vs MVP Cresco

| Problème MVP Cresco- | Solution EASY.Q |
|-------------|-----------------|
| SQLite → concurrence impossible | PostgreSQL async |
| Traductions stockées en mémoire | JSONB en base par langue |
| Pas de cache Gemini | Redis TTL 24h sur réponses OCR |
| Sessions chatbot perdues au refresh | Redis avec TTL 2h |
| Pas de queue pour l'OCR | Background task FastAPI ou Celery |
| Pas de webhook Stripe | `/api/v1/payments/webhook` signé |
| Monolithe fichier unique | Bounded contexts : menus / orders / payments / analytics |

---

## 4. Phase 0 — Fondations ✅ (mostly complete, 2 blockers remain)

> **État au 2026-04-30** : Fondations solides. Redis, R2, modèles tous présents. Reste : `Base.metadata.create_all` à retirer de `main.py`, et `asyncio.run()` dans `public.py` (risque deadlock prod).

### 4.1 Trello cards status

| Card | Status | Notes |
|------|--------|-------|
| Dépôt de marque INPI (classe 42 + 35) | ⏳ À faire | ~250€, délai 6 mois |
| Migration SQLite → PostgreSQL | ✅ Done | |
| Auth restaurateur Clerk | ✅ Done | python-jose JWKS |
| Onboarding création compte | ✅ Done | |
| Bannière cookies CNIL | ✅ Done | |
| Rate limiting API | ✅ Done | slowapi |
| CGU + Politique confidentialité | ✅ Done | |
| Root = site, slug = restaurant | ✅ Done | routing `/pro/*` + `/:slug` |
| Séparation auth restaurateur/client | ✅ Done | |
| Auth admin backoffice | ✅ Done | require_admin + ADMIN_USER_IDS |
| Internationalisation (FR/EN/ES) | ✅ Done | react-i18next |
| Tests unitaires et E2E | 🔧 Partiel | 404 backend + 111 frontend passent, Playwright absent |
| **Configuration Redis** | ✅ Done | aioredis — cache + sessions + pub/sub KDS |
| **Stockage Cloudflare R2** | ✅ Done | upload/download/presigned URLs opérationnels |
| **Modèles Subscription + ChatSession + AuditLog** | ✅ Done | SQLAlchemy + migrations Alembic |
| **`Base.metadata.create_all` à retirer** | 🔧 Reste | `main.py:100` bypass Alembic — supprimer |
| **`asyncio.run()` dans public.py** | 🔧 Reste | Anti-pattern deadlock Uvicorn — rendre endpoints async |

### 4.2 Ce qu'il faut améliorer en Phase 0

#### Backend : modèles manquants à ajouter dès maintenant

```python
# À ajouter dans app/models/

class Subscription(Base):
    """Plan abonnement restaurateur (Freemium / Pro)"""
    __tablename__ = "subscriptions"
    id, restaurant_id, plan: "free" | "pro", stripe_subscription_id
    status: "active" | "past_due" | "canceled"
    current_period_end: DateTime

class ChatSession(Base):
    """Sessions chatbot client (TTL Redis + persistance DB)"""
    __tablename__ = "chat_sessions"
    id, restaurant_id, table_id (nullable), session_token
    messages: JSONB  # [{role, content, timestamp}]
    created_at, expires_at

class AuditLog(Base):
    """Log immuable pour RGPD + debug"""
    __tablename__ = "audit_logs"
    id, actor_type, actor_id, action, resource_type, resource_id
    payload: JSONB, ip_address, created_at
```

#### Frontend : structure cible (feature-based architecture)

```
src/
  features/
    public/
      LandingPage.jsx ⬜         (page marketing, CTA vers onboarding)
    auth/
      LoginPage.jsx ⬜
    restaurant/
      DashboardPage.jsx ⬜       (métriques + menus actifs + actions rapides)
      RestaurantSettingsPage.jsx ⬜ (profil, logo, horaires)
      TablesPage.jsx ⬜          (plan de salle + QR codes)
    menu/
      OCRUploadPage.jsx ⬜       (drag & drop PDF + prévisualisation)
      MenuEditorPage.jsx ⬜      (éditeur post-OCR)
      TranslatorPage.jsx ⬜      (révision traductions FR/EN/ES)
    client/
      MenuPage.jsx ⬜            (menu public, header bg-black sticky)
      CartPage.jsx ⬜            (panier client)
    payment/
      TipPage.jsx ⬜             (pourboire digital)
      CheckoutPage.jsx ⬜        (Stripe Elements)
      ThankYouPage.jsx ⬜        (post-paiement + avis Google)
    kds/
      KitchenScreen.jsx ⬜       (KDS cuisine WebSocket, fond sombre)
    analytics/
      DashboardChartsPage.jsx ⬜  (CA / couverts / chatbot)
    admin/
      AdminDashboardPage.jsx ⬜   (backoffice superadmin)
      UpgradePage.jsx ⬜          (plans Freemium → Pro)
    legal/
      PrivacyPage.jsx ⬜
      TermsPage.jsx ⬜
  components/
    ChatWidget.jsx ✓             (FAB + panneau SSE streaming)
    MenuView.jsx ✓               (sections + vins, grid lg:col-span-3)
    LanguageSelector.jsx ✓
    AllergenIcons.jsx ⬜          (14 allergènes EU — icônes SVG)
    CartSummaryBar.jsx ⬜         (barre sticky bottom du menu client)
    ConsentBanner.jsx ⬜
  hooks/
    useRestaurantMenu.js ⬜
    useCart.js ⬜
    useChatSession.js ⬜
  contexts/
    CartContext.jsx ✓
    AuthContext.jsx ⬜
  lib/
    api.js ✓
    stripe.js ⬜
    analytics.js ⬜
  localization/
    translations.js ✓
```

> **Migration MVP → features** : les fichiers déjà dans `src/pages/` et `src/components/` du MVP (MenuPage, CartPage, ChatWidget, MenuView, CartContext, LanguageSelector) sont à déplacer dans les bounded contexts ci-dessus lors du rebuild.

**Règles de style UI** (palette confirmée par le MVP — noir/blanc/neutral uniquement) :
- Pages : `min-h-screen bg-neutral-50`
- Header : `bg-black text-white sticky top-0 z-40` + `max-w-4xl mx-auto px-4 py-4`
- Cards : `bg-white rounded-xl shadow-sm border border-neutral-200 p-5` ou `p-6`
- Boutons primaires : `bg-black text-white rounded-full font-medium hover:bg-neutral-800`
- Boutons icône : `p-1.5 rounded-full hover:bg-neutral-800 transition-colors`
- Inputs : `px-4 py-3 bg-white border border-neutral-200 rounded-lg focus:ring-2 focus:ring-black outline-none`
- Tags/badges : `text-xs bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded-full`
- Erreurs : `bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm`
- Succès inline (1.5s feedback) : `bg-green-500 text-white` ou `bg-green-100 text-green-700`
- Loader : `<Loader2 className="h-5 w-5 animate-spin" />` (lucide-react, pas de spinner custom)
- Aucune couleur `primary-*`, `midnight`, ni variable CSS custom — tout en `neutral-*`

---

## 5. Phase 1 — Parcours Restaurateur ✅ (complete, 1 runtime bug)

> **État au 2026-04-30** : Toutes les features Phase 1 sont implémentées et testées backend. Un bug bloquant : `TranslatorPage.jsx` appelle `api.post()` qui n'existe pas → crash runtime sur "Traduire tout".

### 5.1 Upload PDF carte (drag & drop + mobile) ✅

**Card Trello** : `69d2bf70b7a240c8777e173c`

**Implémentation backend** :
```python
# POST /api/v1/menus/upload
# - Validation magic bytes b'%PDF-'
# - Taille max 20MB (configurable)
# - Stockage R2/S3 avec presigned URL
# - Déclenche background task OCR (FastAPI BackgroundTasks)
# - Retourne {menu_id, status: "processing"}

@router.post("/menus/upload")
async def upload_menu_pdf(
    file: UploadFile,
    restaurant_id: UUID,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # 1. Valider magic bytes
    # 2. Sauvegarder en storage
    # 3. Créer Menu row avec status="processing"
    # 4. background_tasks.add_task(ocr_task, menu_id)
    # 5. Retourner {menu_id, status}
```

**Implémentation frontend** :
```jsx
// src/features/menu/OCRUploadPage.jsx
// Style : fond bg-neutral-50, card bg-white rounded-xl border border-neutral-200 p-6
// - Zone drag & drop : border border-neutral-200 rounded-lg p-8 text-center hover:border-neutral-400 bg-white
// - Icône Upload (lucide-react) : text-neutral-400 mb-3
// - Prévisualisation PDF inline (PDF.js) : aperçu avant upload
// - Validation côté client : type=PDF, size<20MB
// - Upload avec progression : barre bg-neutral-200 → bg-black
// - Loader : <Loader2 className="h-8 w-8 animate-spin text-neutral-600" />
// - Polling /api/v1/menus/{id}/status jusqu'à "ready"
// - Redirect vers éditeur une fois prêt
```

**Améliorations vs MVP Cresco** :
- Retry automatique si OCR échoue (max 3 tentatives)
- Support upload image (JPG/PNG) en plus du PDF via Gemini Vision
- Prévisualisation PDF inline avant upload (PDF.js)

---

### 5.2 OCR Gemini → JSON structuré ✅

**Card Trello** : `69d2bf710e41e20caa298f6a`

**Service OCR** :
```python
# app/services/ocr_service.py

SYSTEM_PROMPT = """Tu es un expert en extraction de données de cartes de restaurant.
Extrait TOUTES les informations du menu en JSON structuré.
Format: {sections: [{title, items: [{name, description, price, allergens: [], tags: []}]}]}
Règles:
- Prix en float (ex: 12.50, pas "12,50€")
- Allergènes : gluten, lactose, oeufs, poisson, arachides, soja, fruits_coque, celeri, moutarde, sesame, sulfites, lupin, mollusques, crustaces
- Tags : vegetarien, vegan, halal, bio, maison, signature, nouveau
- Si absent → null (ne pas inventer)
"""

async def extract_menu_from_pdf(pdf_path: str) -> MenuExtractResult:
    # 1. Convertir PDF → images (pdf2image)
    # 2. Pour chaque page : appel Gemini Vision
    # 3. Fusionner et dédupliquer les sections
    # 4. Valider avec Pydantic MenuExtractResult
    # 5. Cacher résultat Redis 24h (clé: sha256(pdf_content))
```

**Points d'amélioration critiques** :
- **Cache Redis** sur le hash du PDF → si même PDF re-uploadé, pas de re-OCR (économie tokens)
- **Chunking par page** → évite les timeouts Gemini sur PDFs > 10 pages
- **Confidence score** par item → items incertains marqués pour révision manuelle
- **Fallback** : si Gemini échoue 3 fois → notification restaurateur + option saisie manuelle

---

### 5.3 Éditeur de menu post-OCR ✅

**Card Trello** : `69d2bf71f5f83d3bbcff5d96`

**Architecture** :
```
// src/features/menu/MenuEditorPage.jsx
// Style : bg-neutral-50, sections = cards bg-white rounded-xl border border-neutral-200
MenuEditorPage
├── SectionList (drag & drop reorder)
│   └── SectionItem (collapse/expand) — card bg-white rounded-xl shadow-sm border border-neutral-200 p-6
│       └── MenuItemRow (inline edit) — border-b border-neutral-100 py-4
│           ├── NameField        — input bg-white border border-neutral-200 rounded-lg
│           ├── DescriptionField
│           ├── PriceField       — tabular-nums font-semibold text-neutral-900
│           ├── AllergenPicker   — tags bg-neutral-100 text-neutral-600 rounded-full text-xs
│           ├── TagPicker
│           └── AvailabilityToggle — toggle noir/blanc
├── AddSectionButton — bg-black text-white rounded-full hover:bg-neutral-800
├── SaveButton (debounced auto-save 2s, indicateur text-neutral-500 text-sm)
└── PublishButton — bg-black text-white rounded-lg font-medium
```

**Backend** :
```python
# PATCH /api/v1/menus/{menu_id}/sections/{section_id}/items/{item_id}
# Body: {name?, description?, price?, allergens?, tags?, is_available?, position?}
# Optimistic update côté frontend, confirmation async

# PUT /api/v1/menus/{menu_id}/sections/reorder
# Body: {section_ids: [uuid, uuid, ...]}  # ordre désiré
```

**Améliorations clés** :
- **Auto-save debounced** (2 secondes d'inactivité → save silencieux)
- **Historique de versions** (dernier état avant publication)
- **Mode mobile** : formulaire plein écran par item au lieu d'édition inline
- **Import CSV** en plus du PDF (restaurateurs avec tableur existant)

---

### 5.4 Gestion du plan de table ✅

**Card Trello** : `69d2bf727d35c6fb3b268cf1`

**Modèle** :
```python
class Table(Base):
    __tablename__ = "tables"
    id: UUID, restaurant_id: UUID
    number: str       # "1", "A3", "Terrasse-2"
    label: str | None # "Terrasse", "Salle", "Bar"
    capacity: int
    qr_token: str     # UUID v4 unique, dans l'URL du QR
    is_active: bool
```

**Backend** :
```python
# POST /api/v1/tables/bulk
# Body: {count: 20, prefix: "Table", start_at: 1, zone: "Salle"}
# → Crée N tables avec QR tokens

# GET /api/v1/tables/{table_id}/qr
# → Retourne QR code PNG + URL = https://easy.q/{slug}?table={qr_token}
```

**Frontend** :
```jsx
// src/features/restaurant/TablesPage.jsx
// Style : header bg-black, fond bg-neutral-50, cards bg-white rounded-xl border border-neutral-200
// - Grille visuelle du plan de salle : grid gap-4 md:grid-cols-2 lg:grid-cols-4
// - Chaque table : card p-5 avec numéro (font-semibold), zone (text-neutral-500 text-sm), aperçu QR inline
// - Ajout rapide : "20 tables de la salle" — input + bouton bg-black text-white rounded-full
// - Badge statut : bg-neutral-100 text-neutral-600 rounded-full text-xs
// - Export PDF multi-QR : bouton avec icône Download (lucide-react)
```

---

### 5.5 Génération QR codes (PDF imprimable) ✅

**Card Trello** : `69d2bf72a46fbd45a9fb5aaa`

```python
# app/services/qr_service.py
import qrcode
from reportlab.platypus import SimpleDocTemplate, Image, Paragraph

async def generate_qr_pdf(restaurant: Restaurant, tables: list[Table]) -> bytes:
    """
    Génère un PDF A4 avec tous les QR codes.
    Format : 2 colonnes × N lignes, numéro de table sous chaque QR.
    Inclut : logo restaurant + nom + "Scannez pour voir le menu"
    """
    url_template = f"https://easy.q/{restaurant.slug}?table={{token}}"
    # Générer QR PNG en mémoire (BytesIO) pour chaque table
    # Assembler avec ReportLab ou WeasyPrint
```

**Améliorations** :
- Template PDF personnalisable (couleurs de la marque restaurant)
- Format "mini" (6 QR par page pour tables bar/terrasse)
- Deep link vers section spécifique `?table=X&section=vins`

---

### 5.6 Traduction automatique FR/EN/ES 🔧 (backend ✅, frontend cassé — api.post manquant)

**Card Trello** : `69d2bf73de853d053df06c4a`

```python
# app/services/translation_service.py

TRANSLATE_PROMPT = """Traduis ce menu de restaurant du français vers {target_lang}.
Règles : garder les noms propres de plats (ex: "Crème brûlée"), traduire descriptions.
JSON input/output identique. Ne jamais inventer de prix ou d'allergènes."""

async def translate_menu(menu_id: UUID, target_lang: str, db: AsyncSession):
    # 1. Charger toutes les sections/items du menu
    # 2. Chunker par section (éviter limite tokens)
    # 3. Appel Gemini par chunk
    # 4. Stocker dans item.name_translations = {"fr": ..., "en": ..., "es": ...}
    # 5. Marquer menu.languages = "fr,en,es"
```

**Frontend** :
```jsx
// Dans l'éditeur : bouton "Traduire automatiquement"
// Progress bar section par section
// Review mode : original FR à gauche, traduction à droite, éditable
```

---

### 5.7 Dashboard restaurateur (menus / QR / statuts) ✅

**Card Trello** : `69d2bf7326327c98dd402af7`

**Structure** :
```jsx
// src/features/restaurant/DashboardPage.jsx
// Style : header bg-black text-white, fond bg-neutral-50, max-w-5xl mx-auto px-4 py-8
// Cards : bg-white border border-neutral-200 rounded-xl p-5 hover:border-neutral-400 transition-colors
// Icônes lucide-react : UtensilsCrossed, MessageSquare, QrCode, Upload

Dashboard
├── HeaderStats (CA 7j, commandes, couverts)  ← Phase 5, placeholder maintenant
│   └── Stat card : bg-white rounded-xl border border-neutral-200 p-5, chiffre font-semibold text-neutral-900
├── ActiveMenuCard — bg-white border border-neutral-200 rounded-xl p-5
│   ├── Nom du menu actif (text-lg font-semibold text-neutral-900)
│   ├── Nb de plats + sections (text-sm text-neutral-500)
│   ├── Badge statut : "publié" (bg-neutral-100 text-neutral-600 rounded-full text-xs) / "brouillon"
│   └── Actions : liens text-neutral-900 hover:underline
├── QRCodesCard — même style card
│   ├── Nb de tables (text-sm text-neutral-700)
│   └── Bouton "Télécharger tous les QR (PDF)" — bg-black text-white rounded-full
└── QuickActionsCard — grid gap-4 md:grid-cols-3
    ├── "Uploader une nouvelle carte" — card cliquable hover:border-neutral-400
    ├── "Ajouter des tables"
    └── "Voir les commandes en cours"
```

---

### 5.8 Profil restaurant (logo / horaires / adresse) ✅

**Card Trello** : `69d2bf74bc47dfc785c8986c`

```python
# PATCH /api/v1/restaurants/me
# Body: {name?, logo_url?, address?, opening_hours?, phone?}

# POST /api/v1/restaurants/me/logo
# Multipart upload → Cloudflare R2 → retourne logo_url
```

```jsx
// src/features/restaurant/RestaurantSettingsPage.jsx
// Style : fond bg-neutral-50, sections = cards bg-white rounded-xl border border-neutral-200 p-6
// - Upload logo : zone drag & drop bg-white border border-neutral-200 rounded-lg p-8 hover:border-neutral-400
//   Prévisualisation ronde (rounded-full w-24 h-24)
// - Labels : text-sm font-medium text-neutral-700 mb-2
// - Inputs : px-4 py-3 bg-white border border-neutral-200 rounded-lg focus:ring-2 focus:ring-black
// - Horaires : grille 7 jours × ouverture/fermeture — texte text-neutral-900, séparateurs border-neutral-100
// - Bouton Save : bg-black text-white rounded-full w-full py-3 font-medium hover:bg-neutral-800
// - Preview : card bg-neutral-100 rounded-lg border border-neutral-200 p-4
```

---

### 5.9 Notifications email ✅

**Card Trello** : `69d2bf74cf2dd2560e65ee5f`

```python
# app/services/email_service.py (améliorer le stub existant)

# Templates Resend HTML :
# - welcome.html : bienvenue après onboarding
# - new_payment.html : nouveau paiement reçu (montant, table, heure)
# - bad_review.html : avis < 3 étoiles reçu
# - new_order.html : nouvelle commande cuisine (si KDS non actif)
# - subscription_renewal.html : rappel 3 jours avant renouvellement
```

**Triggers** :
```python
# Dans les routers correspondants :
# webhook Stripe payment.succeeded → send_new_payment_email()
# POST /reviews → if score < 3 → send_bad_review_email()
# POST /orders → if not restaurant.kds_active → send_new_order_email()
```

---

## 6. Phase 2 — Parcours Client (Menu Digital) ✅ (mostly complete, CartContext scope issue)

> **État au 2026-04-30** : Menu client, ChatWidget SSE, panier, waiter call, allergens, CartSummaryBar tous implémentés. Bug: CartContext non scopé par restaurant → risque contamination panier inter-sessions.

### 6.1 Menu PWA (scan QR → sans app) ✅

**Card Trello** : `69d2bf75003097a7ec1b633d`

**Route** : `/:slug?table=TOKEN&lang=fr`

```jsx
// src/features/client/MenuPage.jsx
// (Migrer depuis src/pages/MenuPage.jsx du MVP)
// Style confirmé : header bg-black text-white sticky top-0 z-40, fond min-h-screen bg-neutral-50 pb-24

MenuPage
├── useRestaurantMenu(slug)     // charge menu + restaurant + langue
├── StickyHeader — bg-black text-white sticky top-0 z-40
│   ├── RestaurantName (text-xl font-semibold tracking-tight) + logo
│   ├── TableIndicator ("Table 5") — text-xs text-neutral-400
│   └── LanguageSelector + CartButton (icône ShoppingCart lucide, badge bg-white text-black rounded-full)
├── CategoryNav (sticky scroll) — bg-black text-white, ancres via IntersectionObserver
├── main.max-w-4xl.mx-auto.px-4.py-6
│   └── MenuView (composant existant ✓)
│       └── MenuSection — card bg-white rounded-xl shadow-sm border border-neutral-200 p-6
│           ├── Titre : text-lg font-bold text-neutral-900 uppercase tracking-wide border-b border-neutral-200
│           └── MenuItem — border-b border-neutral-100 py-4
│               ├── Name (font-medium text-neutral-900)
│               ├── Description (text-sm text-neutral-500 mt-1)
│               ├── Tags (bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded-full text-xs)
│               ├── Price (font-semibold text-neutral-900 whitespace-nowrap)
│               ├── AllergenIcons ⬜ (14 icônes EU, tooltip au hover)
│               └── AddToCartButton — bg-black text-white rounded-full px-3 py-1.5 text-sm hover:bg-neutral-800
│                   Ajouté : bg-green-500 text-white (1.5s feedback)
├── ChatWidget (composant existant ✓) — FAB bg-black bottom-6 right-6 rounded-full
└── CartSummaryBar ⬜ — sticky bottom-0 bg-black text-white px-4 py-3
    └── "3 articles · 42,50€ → Voir le panier"
```

**Performance critique** :
- SSR/SSG pour les menus publics → Vite + prerender ou Next.js (à évaluer Phase 2)
- Skeleton loading dès le premier octet
- Service Worker cache menu 5 minutes (offline si coupure réseau)
- Images WebP avec `loading="lazy"` + `decoding="async"`
- LCP < 2.5s sur 4G → objectif

**Backend** :
```python
# GET /api/v1/public/{slug}
# Public, pas d'auth
# Retourne : restaurant + menu actif + sections + items (traduits selon ?lang=)
# Cache Redis 5 minutes (clé: f"menu:{slug}:{lang}")
# Cache-Control: public, max-age=300

# Invalider cache lors de chaque PATCH menu item
```

---

### 6.2 Navigation menu (onglets / sections) ✅

**Card Trello** : `69d2bf755b2a12b01053dec2`

```jsx
// CategoryNav : barre horizontale scrollable (snap scroll)
// Sur mobile : swipe horizontal + scroll vertical dans la section

// Ancrage fluide :
const scrollToSection = (sectionId) => {
  document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// Active state : IntersectionObserver pour détecter section visible
```

---

### 6.3 Chatbot IA serveur virtuel (SSE streaming) ✅

**Card Trello** : `69d2bf76d91bc3ca87d4317c`

**Backend** :
```python
# POST /api/v1/chat/stream
# Body: {session_id, message, restaurant_id, table_id?, lang}
# Response: text/event-stream

SYSTEM_PROMPT = """Tu es le serveur virtuel de {restaurant_name}.
Tu connais parfaitement la carte :
{menu_context}

Règles :
- Réponds en {lang}
- Sois chaleureux mais concis
- Si un client veut commander, liste les plats en **gras** (parsés par le frontend pour ajouter au panier)
- Gère les allergènes avec précaution (indique toujours "à vérifier avec le personnel")
- Si tu ne sais pas → dis-le, ne pas inventer
"""

@router.post("/chat/stream")
async def chat_stream(body: ChatRequest):
    session = await redis.get_session(body.session_id)
    menu_context = await get_menu_context(body.restaurant_id)  # depuis cache Redis

    async def event_generator():
        async for chunk in gemini.stream(
            system=SYSTEM_PROMPT.format(...),
            history=session.messages,
            message=body.message,
        ):
            yield f"data: {json.dumps({'text': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

**Frontend** :
```jsx
// src/components/ChatWidget.jsx (existe déjà ✓ — migrer vers src/features/client/ChatWidget.jsx)
// Style confirmé :
// - FAB : fixed bottom-6 right-6 w-14 h-14 bg-black text-white rounded-full shadow-lg hover:bg-neutral-800 hover:scale-105
// - Panneau : fixed bottom-6 right-6 w-96 h-[520px] bg-white rounded-2xl shadow-2xl border border-neutral-200
// - Header panneau : bg-black text-white px-4 py-3 — icône Bot dans cercle bg-white rounded-full
// - Zone messages : bg-neutral-50 flex-1 overflow-y-auto p-4 space-y-3
// - Bulles user : bg-black text-white rounded-2xl rounded-br-sm (max-w-[80%])
// - Bulles assistant : bg-white text-neutral-900 border border-neutral-200 rounded-2xl rounded-bl-sm
// - Curseur streaming : inline-block w-1.5 h-4 bg-black animate-pulse
// - Typing indicator : Loader2 animate-spin dans cercle bg-black
// - Parsing **gras** → DishButton : bg-neutral-100 hover:bg-neutral-200 text-black rounded-md
//   Après ajout : bg-green-100 text-green-700 (2s feedback)
// - Input : bg-neutral-100 border-none rounded-full flex-1 px-4 py-2.5
// - Bouton envoi : w-10 h-10 bg-black text-white rounded-full disabled:opacity-50
// - Historique persisté en localStorage + sauvegarde API
```

**Améliorations critiques vs MVP** :
- Session Redis avec TTL 2h (pas juste localStorage)
- Contexte menu injecté depuis cache Redis (pas rechargé à chaque message)
- Langage détecté automatiquement depuis URL `?lang=`
- Fonction tool calling Gemini : `add_to_cart(item_id, quantity)` → ajoute directement

---

### 6.4 Recommandations IA (allergènes / goûts) ✅ (via system prompt Gemini)

**Card Trello** : `69d2bf768c446d538e944189`

```python
# Intégré dans le context system prompt du chatbot :
# Au premier message, demander optionnellement :
# "Avez-vous des allergènes ou préférences alimentaires ?"
# Stocker dans session.preferences = {allergens: [], diet: "vegetarien"}
# Filter côté IA ET côté rendu (icônes allergènes sur les cards)
```

---

### 6.5 Accords mets/vins ✅ (via contexte Gemini)

**Card Trello** : `69d2bf7754dfd2cff15ed167`

- Injecté dans le context Gemini : section vins complète du menu
- Gemini peut suggérer des vins spécifiques de la carte avec le prix

---

### 6.6 Panier client 🔧 (implémenté, mais CartContext non scopé par restaurant)

**Card Trello** : `69d2bf779b0419f473149e3e`

```jsx
// src/contexts/CartContext.jsx (migrer depuis src/context/CartContext.jsx du MVP)
// Persisté en localStorage + synchro tab via BroadcastChannel

const CartContext = {
  items: [{id, name, price, quantity, notes}],
  restaurantId, tableId,
  addItem(item), removeItem(id), updateQty(id, qty),
  total, count,
  clear()
}

// src/features/client/CartPage.jsx
// (Migrer depuis src/pages/CartPage.jsx du MVP)
// Style : fond bg-neutral-50, header bg-black text-white
// - Liste items : cards bg-white rounded-xl border border-neutral-200 p-5
//   Contrôles +/- : boutons p-1.5 rounded-full hover:bg-neutral-100 border border-neutral-200
//   Supprimer : icône Trash2 text-neutral-400 hover:text-red-500
//   Notes : input bg-white border border-neutral-200 rounded-lg text-sm
// - Total : section bg-white rounded-xl border border-neutral-200 p-5, séparateurs border-neutral-100
//   Total HT + TVA 10% (restauration) : text-neutral-500 text-sm
//   Total TTC : font-semibold text-neutral-900
// - Bouton "Commander" / "Payer" : bg-black text-white rounded-full w-full py-3 font-medium
```

**Détail important** :
```jsx
// Parser les réponses chatbot pour détecter les plats en gras :
const parseChatMessage = (text) => {
  // Regex: **Nom du plat** → bouton inline "Ajouter au panier"
  const boldPattern = /\*\*([^*]+)\*\*/g;
  // Matcher avec menu items par nom fuzzy
};
```

---

### 6.7 Allergènes par plat (icônes EU) ✅

**Card Trello** : `69d2bf791a97d88135accda6`

```jsx
// src/components/AllergenIcons.jsx
// 14 allergènes réglementaires EU :
const ALLERGENS = {
  gluten: { icon: WheatIcon, label: "Gluten" },
  crustaces: { icon: ShrimpIcon, label: "Crustacés" },
  oeufs: { icon: EggIcon, label: "Œufs" },
  poisson: { icon: FishIcon, label: "Poisson" },
  arachides: { icon: PeanutIcon, label: "Arachides" },
  soja: { icon: SojaIcon, label: "Soja" },
  lactose: { icon: MilkIcon, label: "Lait" },
  fruits_coque: { icon: NutIcon, label: "Fruits à coque" },
  celeri: { icon: CeleryIcon, label: "Céleri" },
  moutarde: { icon: MustardIcon, label: "Moutarde" },
  sesame: { icon: SesameIcon, label: "Sésame" },
  sulfites: { icon: WineIcon, label: "Sulfites" },
  lupin: { icon: FlowerIcon, label: "Lupin" },
  mollusques: { icon: ShellIcon, label: "Mollusques" },
};
// → Icônes SVG custom ou bibliothèque spécialisée (Food Allergy icons)
// → Tooltip au hover/tap avec nom complet
```

---

### 6.8 Appel serveur ✅

**Card Trello** : `69d2bf782c9a434691ab2bfd`

```python
# POST /api/v1/public/{slug}/call-waiter
# Body: {table_token, message?: "Demande l'addition"}
# → WebSocket broadcast vers KDS/dashboard restaurateur
# → Notification push optionnelle (Web Push API)
```

---

### 6.9 Upsell IA contextuel ❌ (non implémenté — règles basiques manquantes)

**Card Trello** : `69d2bf795fde85c2f5e087ce`

```python
# Après ajout d'un plat au panier, le chatbot envoie automatiquement :
# Basé sur les données de co-commandes historiques (Phase 5)
# Fallback : règles basiques (fromage → vin rouge, poisson → vin blanc)
```

---

## 7. Phase 3 — Paiement à Table ✅ (core complete — Apple/Google Pay et Stripe Connect manquants)

> **État au 2026-04-30** : Flux principal Stripe opérationnel, tip, thank-you, reçu PDF, avis Google. Manque : wallet payments (Apple/Google Pay) et Stripe Connect (versements restaurant).

### 7.1 Stripe Payment Intents ✅

**Card Trello** : `69d2bf7a6df15683e71be434`

**Backend** :
```python
# POST /api/v1/payments/intent
# Body: {order_id, tip_amount}
# → stripe.PaymentIntent.create(amount, currency="eur", capture_method="automatic")
# → Retourne {client_secret, payment_intent_id}

# POST /api/v1/payments/webhook
# Vérification signature Stripe (stripe.Webhook.construct_event)
# Events : payment_intent.succeeded → update Order.status = "paid"
#          payment_intent.payment_failed → notify + retry possible

# Important : TOUJOURS valider le montant côté backend
# Ne jamais faire confiance au montant envoyé par le frontend
```

**Frontend** :
```jsx
// src/features/payment/CheckoutPage.jsx
// Style : fond bg-neutral-50, header bg-black text-white
// Résumé commande : card bg-white rounded-xl border border-neutral-200 p-6
//   Items : border-b border-neutral-100 py-3, prix font-medium text-neutral-900
//   Total : font-semibold text-neutral-900
// Stripe Elements : wrapper bg-white rounded-xl border border-neutral-200 p-6
//   StripeElement applique son propre style — laisser les defaults Stripe (fond blanc, bord neutre)
// Bouton "Payer X€" : bg-black text-white rounded-full w-full py-3 font-medium hover:bg-neutral-800
//   Loading : Loader2 animate-spin inline
// Jamais de données carte en clair dans notre code
// loadStripe() → lazy load du SDK Stripe
```

---

### 7.2 Apple Pay + Google Pay ❌ (PaymentRequestButton non implémenté)

**Card Trello** : `69d2bf7af7c91bfa7953ddd2`

```jsx
// Stripe PaymentRequestButton (gère automatiquement Apple Pay / Google Pay)
const paymentRequest = stripe.paymentRequest({
  country: 'FR',
  currency: 'eur',
  total: { label: 'EASY.Q', amount: totalInCents },
  requestPayerName: false,
  requestPayerEmail: false, // RGPD : ne pas collecter sans consentement
});

// Prérequis : domaine HTTPS + verification Apple Pay domain
// Stripe gère les certificats automatiquement
```

---

---

### 7.4 Pourboire digital ✅

**Card Trello** : `69d2bf7c89f7a07624495723`

```jsx
// src/features/payment/TipPage.jsx
// Style : fond bg-neutral-50, card bg-white rounded-xl border border-neutral-200 p-6
// Boutons présélectionnés : 0% / 5% / 10% / 15%
//   Non sélectionné : bg-white border border-neutral-200 rounded-full px-4 py-2 text-neutral-900
//   Sélectionné : bg-black text-white rounded-full px-4 py-2 font-medium
// Montant pourboire EN EUROS : text-2xl font-semibold text-neutral-900 text-center
// Champ montant libre : input bg-white border border-neutral-200 rounded-lg px-4 py-3
// Bouton "Confirmer" : bg-black text-white rounded-full w-full py-3 font-medium hover:bg-neutral-800
// Pourboire ajouté au PaymentIntent (amount += tip_amount)
```

---

### 7.5 Reçu PDF par email ✅

**Card Trello** : `69d2bf7cda3c3c91740e2a12`

```python
# app/services/receipt_service.py
# Déclenché par webhook payment_intent.succeeded

async def send_receipt(payment_id: UUID):
    payment = await db.get(Payment, payment_id)
    # Générer PDF avec WeasyPrint ou reportlab
    # Contenu : logo restaurant, date, table, items, total HT, TVA, pourboire, total TTC
    # Numéro de ticket (timestamp + 6 chars hex)
    pdf_bytes = generate_receipt_pdf(payment)
    # Upload R2 avec URL signée 1 an
    await resend.send(
        to=payment.customer_email,
        subject=f"Votre reçu {restaurant.name}",
        html=render_receipt_email(payment, pdf_url),
        attachments=[{"filename": "recu.pdf", "content": pdf_bytes}]
    )
```

---

### 7.6 Demande d'avis Google post-paiement ✅

**Card Trello** : `69d2bf7db927d5c5648aa4a5`

```jsx
// src/features/payment/ThankYouPage.jsx
// Style : fond bg-neutral-50, card central bg-white rounded-xl border border-neutral-200 p-8 text-center
// - Icône CheckCircle (lucide-react) text-neutral-800 h-12 w-12 mx-auto mb-4
// - "Paiement confirmé" : text-2xl font-semibold text-neutral-900
// - Montant : text-neutral-500
// - Séparateur border-neutral-100
// - CTA Google : bouton bg-black text-white rounded-full px-6 py-3 font-medium hover:bg-neutral-800
//   Deep link : https://search.google.com/local/writereview?placeid={google_place_id}
// - Si pas de place_id → bouton caché (pas d'élément vide)

// Configuration côté restaurateur :
// Settings → "Mon ID Google Maps" → colle depuis Google Business Profile
// Stocké dans restaurant.google_place_id
```

---

### 7.7 Stripe Connect (versements restaurateur) ❌ (non implémenté — pas de transfer_data ni application_fee)

**Card Trello** : `69d2bf7daa873b49526ba14e`

```python
# Onboarding Stripe Connect :
# POST /api/v1/payments/connect/onboard
# → stripe.AccountLink.create(type="account_onboarding")
# → redirect vers Stripe, retour sur /pro/settings?connect=success

# Sur chaque PaymentIntent :
# transfer_data = {destination: restaurant.stripe_account_id}
# application_fee_amount = int(total_cents * 0.005)  # 0.5% commission EASY.Q
```

---

### 7.8 Retours utilisateurs post-paiement ✅ (NPS + feedback + détracteur email)

**Card Trello** : `69d39e46ac60b40e4dda5246`

```jsx
// Page remerciement : 2 questions max (NPS + open-ended)
// "Sur 10, recommanderiez-vous ce restaurant ?" → 1-10
// "Un commentaire pour le restaurant ?" → textarea optionnel

// Stocké en DB + agrégé dans analytics restaurateur
// Trigger email au restaurateur si score < 7
```

---

## 8. Phase 4 — Commande à Table (KDS) ✅ (complet, path KDS mineur à aligner)

> **État au 2026-04-30** : Commande chatbot function-calling, KDS WebSocket, timer >15min, reconnexion auto tous implémentés. Scan & Go absent.

### 8.1 Commande via chatbot → envoyée en cuisine ✅

**Card Trello** : `69d2bf7f8d74083cb17743c1`

```python
# Tool calling Gemini pour structurer la commande :
tools = [{
    "function_declarations": [{
        "name": "place_order",
        "description": "Envoyer une commande en cuisine",
        "parameters": {
            "items": [{"item_id": "uuid", "quantity": 1, "notes": "sans oignons"}],
            "table_id": "uuid"
        }
    }]
}]

# Quand Gemini appelle la fonction → créer Order + OrderItems en DB
# → broadcast WebSocket vers KDS
```

---

### 8.2 KDS temps réel (WebSocket) ✅

**Card Trello** : `69d2bf80b3887980d7ada452`

**Backend** :
```python
# WebSocket /api/v1/ws/kds/{restaurant_id}
# Auth : token restaurant (pas Clerk, token KDS simplifié)

class KDSConnectionManager:
    def __init__(self):
        self.connections: dict[UUID, list[WebSocket]] = {}

    async def broadcast_order(self, restaurant_id: UUID, order: dict):
        for ws in self.connections.get(restaurant_id, []):
            await ws.send_json({"type": "new_order", "data": order})

    async def broadcast_status_update(self, restaurant_id: UUID, order_id: UUID, status: str):
        # Mis à jour quand cuisine clique "En préparation" / "Prêt"
```

**Frontend KDS** :
```jsx
// src/features/kds/KitchenScreen.jsx
// Style adapté tablette cuisine : fond bg-neutral-900 (écran sombre), texte text-white
// Colonnes Kanban : grid grid-cols-4 gap-4 p-4 h-screen
//   En-tête colonne : text-sm font-semibold text-neutral-400 uppercase tracking-wide mb-3
//   Card commande : bg-neutral-800 rounded-xl p-4 border border-neutral-700 mb-3
//     Numéro table : text-xl font-bold text-white
//     Items : text-sm text-neutral-300, notes : text-xs text-neutral-500
//     Chronomètre : text-xs text-neutral-400 (rouge si > 15 min : text-red-400)
//   Bouton action : bg-white text-black rounded-full px-3 py-1.5 text-sm font-medium hover:bg-neutral-100
// Son d'alerte à chaque nouvelle commande (optionnel)
// Auto-refresh si WebSocket coupé (reconnexion exponentielle)
```

---

### 8.3 Modification commande (fenêtre 2 min) ✅

**Card Trello** : `69d2bf8147ff9f7eac322596`

```python
# Ordre status = "pending" pendant 120 secondes
# Passé ce délai → "confirmed" (verrouillé)
# PATCH /api/v1/orders/{id} : si status != "pending" → 409 Conflict
```

---

### 8.4 Mode Scan & Go ❌ (non implémenté)

**Card Trello** : `69d2bf8235d5d11df6af8285`

```
Flow : QR scan → menu → ajout panier → paiement → numéro de retrait
Pas de table assignée (table_id = null)
Numéro de retrait = compteur incrémental par jour par restaurant
KDS affiche : commandes "à emporter" dans colonne séparée
```

---

### 8.5 Gestion ruptures de stock temps réel ✅ (PATCH is_available + invalide cache Redis)

**Card Trello** : `69d2bf8277b37f1c7065626a`

```python
# PATCH /api/v1/menus/{menu_id}/items/{item_id}
# Body: {is_available: false}
# → Invalide cache Redis du menu
# → Broadcast WebSocket à tous les clients connectés sur ce restaurant
# (Restaurant peut voir en temps réel sur le dashboard qui est connecté)
```

---

## 9. Phase 5 — Analytics & Admin 🔧 (analytics complet, admin cassé en prod)

> **État au 2026-04-30** : Analytics (revenue/covers/items/chatbot/heatmap/CSV export) complets et testés. Admin backoffice cassé : auth mismatch front↔back + champ `publish_status` vs `status` désaligné.

### 9.1 Dashboard restaurateur : CA / couverts / panier moyen ✅

**Card Trello** : `69d2bf84889adf27f8c0e765`

```python
# GET /api/v1/analytics/summary?period=7d|30d|custom&from=&to=
# Retourne :
{
    "revenue": 4250.00,          # CA total (paiements succeeded)
    "revenue_delta_pct": +12.5,  # vs période précédente
    "covers": 187,               # nb de commandes uniques (≈ couverts)
    "avg_basket": 22.72,         # panier moyen
    "tips_total": 210.00,
    "top_items": [{"name", "count", "revenue"}],  # top 10
    "hourly_heatmap": {...},      # heatmap heures
}
```

**Frontend** :
```jsx
// src/features/analytics/DashboardChartsPage.jsx
// Style : fond bg-neutral-50, header bg-black text-white, max-w-5xl mx-auto px-4 py-8
// - KPI cards : grid grid-cols-2 lg:grid-cols-4 gap-4
//   Card : bg-white rounded-xl border border-neutral-200 p-5
//   Valeur : text-2xl font-semibold text-neutral-900
//   Label : text-sm text-neutral-500
//   Delta : text-sm text-neutral-600 (hausse/baisse sans couleurs vives)
// - Line chart CA : recharts — couleur stroke="#000000", fond blanc, axe text-neutral-500
// - Bar chart top plats : fill="#000000", hover fill="#404040"
// - Heatmap heures : intensité en nuances de neutral (neutral-100 → neutral-900)
// - Sélecteur période : boutons bg-white border border-neutral-200 rounded-full
//   Actif : bg-black text-white rounded-full
```

---

### 9.2 Analytics chatbot (questions fréquentes) ✅

**Card Trello** : `69d2bf85a032bb6cead5c80b`

```python
# Background job quotidien (APScheduler ou Celery beat) :
# 1. Récupérer tous les messages clients des dernières 24h
# 2. Appel Gemini : "Classe ces questions en thèmes, top 10"
# 3. Stocker dans analytics_chatbot_topics (restaurant_id, date, topics: JSONB)

# GET /api/v1/analytics/chatbot?period=7d
# Retourne {topics: [{theme, count, example_questions: []}]}
```

---

### 9.3 Export comptable CSV ✅

**Card Trello** : `69d2bf869022c5e8d18da3f6`

```python
# GET /api/v1/analytics/export?from=2026-01-01&to=2026-01-31&format=csv
# Colonnes : date, heure, table, items, montant_ht, tva, pourboire, total_ttc, stripe_payment_id
# Compatible Sage / QuickBooks / EBP (séparateur point-virgule, encoding UTF-8 BOM)
```

---

### 9.4 Backoffice admin global 🔧 (backend OK, frontend cassé — auth mismatch + status field désaligné)

**Card Trello** : `69d2bf834d4f40f1eab78b60` + `83ae89e003b9694c8e` + `841fc1523bebd7af7c`

```jsx
// src/features/admin/AdminDashboardPage.jsx
// Style : fond bg-neutral-50, header bg-black text-white, max-w-5xl mx-auto px-4 py-8
// - Métriques globales : KPI cards bg-white rounded-xl border border-neutral-200 p-5
//   (MRR, churn, nb restaurants actifs, volume transactions)
// - Liste restaurants : grid gap-4 md:grid-cols-2
//   Card : bg-white border border-neutral-200 rounded-xl p-5 hover:border-neutral-400 transition-colors
//   Badges plan : "Pro" (bg-black text-white text-xs rounded-full px-2 py-0.5) / "Free" (bg-neutral-100 text-neutral-600)
//   Badges statut : "actif" / "suspendu" — même style badge
// - Actions : bouton "Suspendre" (border border-neutral-200 rounded-full text-sm)
//   Dialog confirmation : bg-white rounded-xl border border-neutral-200 p-6
// - Lien vers Stripe Dashboard : text-neutral-900 hover:underline text-sm
```

---

## 10. Phase 6 — Croissance & Monétisation 🔧 (Stripe Billing done, reste non commencé)

> **État au 2026-04-30** : Stripe Billing (checkout/portal/webhook), UpgradePage et Pro gating implémentés (mais gating permissif si subscription absente). Le reste de la phase 6 est non commencé.

### 10.1 Freemium → Pro (Stripe Billing) 🔧 (implémenté mais gating permissif si subscription absente)

**Card Trello** : `69d2bf881da5d655db2684c1`

```python
# Plans :
# - FREE : 1 menu, sans paiement en ligne, sans analytics
# - PRO (49€/mois) : menus illimités, paiement Stripe, analytics, avis Google, priorité support

# Stripe Billing :
# stripe.Product.create(name="EASY.Q Pro")
# stripe.Price.create(unit_amount=4900, currency="eur", recurring={"interval": "month"})

# Middleware plan check :
@router.post("/menus/upload")
async def upload(current_user, subscription=Depends(require_plan("pro"))):
    ...

# Page upgrade :
# /pro/upgrade → affiche plans + CTA vers Stripe Checkout
# Webhook subscription.created/updated/deleted → update DB
```

---

### 10.2 Intégration POS (Zelty / Lightspeed) ❌

**Card Trello** : `69d2bf877b0ec6a33edfe38f`

```python
# app/integrations/zelty.py
# Zelty REST API : sync carte → EASY.Q (webhook bidirectionnel)
# Sync commandes EASY.Q → Zelty (pour stocks et CA)

# Architecture : 
# Restaurant configure API key Zelty dans settings
# Cron toutes les 5 minutes : sync si changement détecté
# Conflict resolution : Zelty = source de vérité pour prix/disponibilité
```

---

### 10.3 Programme de fidélité ❌

**Card Trello** : `69d2bf87fc77cda0de0aab4d`

```python
# Compte client optionnel (email + magic link)
# Modèle LoyaltyAccount : customer_email, restaurant_id, points, visits
# 1 visite = 1 point, 10 points = réduction 5%
# Consentement RGPD explicite avant activation
```

---

### 10.4 CRM restaurateur ❌

**Card Trello** : `69d2bf88a9ec0c89378b6ff7`

```
Pour clients avec compte fidélité (consentement explicite) :
- Fréquence de visite (nb visites / 30j)
- Panier moyen
- Plats préférés (top 5)
- Dernière visite
Export CSV client (droit à la portabilité RGPD)
```

---

### 10.5 Widget avis Google ❌ (Google Places API rating non implémentée sur page menu client)

**Card Trello** : `69d2bf899e650632b4f6e449`

```jsx
// Sur la page menu client : note Google du restaurant
// API Google Places → GET /maps/api/place/details?place_id=...&fields=rating,user_ratings_total
// Cache Redis 1h (éviter dépassement quota)
// Si pas de place_id configuré → composant invisible
```

---

### 10.6 Multi-établissements ❌

**Card Trello** : `69d2bf89ca6a1075b621f249`

```python
# Modèle RestaurantGroup :
# Un User peut être owner de plusieurs restaurants (lever la contrainte unique)
# ou inviter des membres (RBAC : owner / manager / staff)
# Vue consolidée : CA groupe + top restaurant + export global
```

---

## 11. Améliorations transversales

### 11.1 Ce qui manque dans le codebase actuel

#### Backend

| Manque | Priorité | Solution |
|--------|----------|---------|
| Aucun router `/menus` | 🔴 Critique | Créer `app/routers/menu.py` |
| Aucun router `/chat` | 🔴 Critique | Créer `app/routers/chat.py` |
| Aucun router `/tables` | 🔴 Critique | Créer `app/routers/tables.py` |
| Aucun router `/payments` | 🔴 Critique | Créer `app/routers/payment.py` |
| Aucun service Gemini | 🔴 Critique | Créer `app/services/gemini_service.py` |
| Pas de Redis | 🟠 Important | Ajouter `aioredis`, cache menu + sessions |
| Pas de background tasks structurées | 🟠 Important | Celery + Redis broker ou FastAPI BG tasks |
| Modèle Subscription absent | 🟠 Important | Ajouter + middleware plan check |
| Modèle ChatSession absent | 🟠 Important | Ajouter pour historique chatbot |
| Pas de tests routers | 🟠 Important | pytest + httpx async client |
| Pas de migrations schema complètes | 🟠 Important | Alembic autogenerate |
| Stockage fichiers local (`/storage`) | 🟡 Moyen | Migrer vers Cloudflare R2 |

#### Frontend

| Manque | Priorité | Solution |
|--------|----------|---------|
| Migration vers feature-based architecture | 🔴 Critique | Restructurer `src/pages/` → `src/features/` (bounded contexts) |
| ChatWidget FAB couleur incorrecte | 🔴 Critique | `bg-primary-600` → `bg-black` dans `src/components/ChatWidget.jsx:198` ✓ corrigé |
| `src/features/client/` | 🔴 Critique | MenuPage + CartPage (migrer depuis `src/pages/`) |
| `src/features/payment/` | 🔴 Critique | CheckoutPage + TipPage + ThankYouPage |
| `src/features/menu/` | 🔴 Critique | OCRUploadPage + MenuEditorPage + TranslatorPage |
| `src/features/restaurant/` | 🟠 Important | DashboardPage + TablesPage + RestaurantSettingsPage |
| `src/features/kds/` | 🟠 Important | KitchenScreen (WebSocket, fond sombre) |
| `src/features/analytics/` | 🟠 Important | DashboardChartsPage (recharts, palette neutral) |
| `CartSummaryBar` sticky bas du menu | 🟠 Important | `src/components/CartSummaryBar.jsx` — Trello Phase 2 |
| `AllergenIcons` (14 EU) | 🟠 Important | `src/components/AllergenIcons.jsx` |
| Pas de PWA Service Worker | 🟠 Important | vite-plugin-pwa — Trello Phase 2 |
| Pas d'optimistic updates | 🟡 Moyen | TanStack Query (remplacer useState + useEffect manuels) |

---

### 11.2 Refactoring recommandés

#### Remplacer `useApi.js` par TanStack Query

```jsx
// Actuel (fragile) :
const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);
useEffect(() => { fetchData(); }, []);

// Recommandé :
const { data, isLoading, error, refetch } = useQuery({
  queryKey: ['restaurant', 'me'],
  queryFn: () => api.get('/restaurants/me'),
  staleTime: 5 * 60 * 1000,
});

// Bénéfices : cache automatique, retry, background refetch, devtools
```

#### Normaliser les erreurs API

```python
# app/core/exceptions.py — handler global
@app.exception_handler(RequestValidationError)
async def validation_handler(request, exc):
    return JSONResponse(
        status_code=422,
        content={"code": "VALIDATION_ERROR", "details": exc.errors()},
    )

# Format uniforme :
# { "code": "RESTAURANT_NOT_FOUND", "message": "...", "details": {} }
```

#### Typage strict frontend

```typescript
// Migrer progressivement vers TypeScript
// Commencer par les types partagés : src/types/api.ts
interface Restaurant { id: string; name: string; slug: string; ... }
interface MenuItem { id: string; name: string; price: number; allergens: string[]; ... }
```

---

## 12. Tests & Qualité

### 12.1 Stratégie de tests

```
Pyramide recommandée :
- Unit (80%) : fonctions pures, services, hooks
- Integration (15%) : routers FastAPI, composants avec mocks API
- E2E (5%) : flows critiques (upload menu, commande, paiement)
```

### 12.2 Backend (pytest)

```python
# Tests à écrire en priorité :

# test_ocr_service.py
# - OCR sur PDF fixture → JSON attendu
# - Gestion PDF corrompu
# - Cache Redis (mock redis)

# test_menu_router.py
# - Upload PDF → 202 + menu_id
# - PATCH item → mis à jour en DB
# - GET public/{slug} → cache correct

# test_payment_router.py  
# - Création PaymentIntent → montant correct
# - Webhook Stripe signé → order mis à jour
# - Webhook non signé → 400

# test_chat_router.py
# - Stream SSE → événements corrects
# - Session persistée Redis
# - Injection prompt → refusée

# Coverage cible : 80%
```

### 12.3 Frontend (Vitest + Playwright)

```javascript
// Tests unitaires Vitest (existants à enrichir) :
// - CartContext : add/remove/qty/total
// - ChatWidget : parsing **gras** → bouton ajout panier
// - AllergenIcons : rendu correct par allergène
// - getSafeRedirectUrl ⬜ déjà testé

// Tests E2E Playwright :
// test('flow complet client : scan → menu → commande → paiement')
// test('restaurateur : upload PDF → OCR → éditeur → publication')
// test('admin : suspendre restaurant → email envoyé')

// Playwright config :
// Base URL locale (fixtures FastAPI + Stripe test mode)
// Screenshot on failure
// Test sur 375px (mobile) + 1440px (desktop)
```

---

## 13. CI/CD & Déploiement

### 13.1 GitHub Actions pipeline

```yaml
# .github/workflows/ci.yml

on: [push, pull_request]

jobs:
  backend:
    runs-on: ubuntu-latest
    services:
      postgres: { image: postgres:16, env: {...} }
      redis:    { image: redis:7 }
    steps:
      - pytest --cov=app --cov-fail-under=80
      - mypy app/ (type checking)
      - ruff check (linting)

  frontend:
    steps:
      - npm run test (vitest)
      - npm run build (vérif build)
      - npm run lint (eslint)

  e2e:
    needs: [backend, frontend]
    steps:
      - docker-compose up (stack complète)
      - npx playwright test
```

### 13.2 Déploiement Railway

```yaml
# railway.toml
[deploy]
startCommand = "uvicorn app.main:app --host 0.0.0.0 --port $PORT"
healthcheckPath = "/health"
healthcheckTimeout = 300

[environments.production]
variables:
  DATABASE_URL = "@railway_postgresql"
  REDIS_URL = "@railway_redis"
```

### 13.3 Variables d'environnement requises

```bash
# Backend
DATABASE_URL=postgresql+asyncpg://...
REDIS_URL=redis://...
CLERK_SECRET_KEY=sk_...
CLERK_JWKS_URL=https://...clerk.accounts.dev/.well-known/jwks.json
GEMINI_API_KEY=...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECT_CLIENT_ID=ca_...
RESEND_API_KEY=re_...
R2_BUCKET_NAME=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
CORS_ORIGINS=https://easy.q,https://www.easy.q
IS_PRODUCTION=true

# Frontend
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
VITE_API_BASE_URL=https://api.easy.q
```

---

## 14. Sécurité & RGPD

### 14.1 Sécurité API

| Mesure | Status | Détail |
|--------|--------|--------|
| Auth JWT Clerk | ⬜ À faire | JWKS verification |
| Rate limiting | ⬜ À faire | slowapi 60 req/min |
| Security headers | ⬜ À faire | HSTS, X-Frame, nosniff |
| Input validation | ⬜ À faire | Pydantic sur tous les schemas |
| SQL injection | ⬜ À vérifier | SQLAlchemy ORM (pas de raw SQL) |
| CORS strict | ⬜ À faire | origins whitelist |
| Webhook Stripe signé | ⬜ À faire | `stripe.Webhook.construct_event` |
| Sanitization uploads | ⬜ À faire | magic bytes PDF, taille max |
| Content Security Policy | ⬜ À faire | Header CSP restrictif |
| Secrets en env vars | ⬜ À faire | jamais en code |

### 14.2 RGPD checklist

```
⬜ Bannière consentement cookies (nécessaires / analytics)
⬜ CGU et politique de confidentialité
⬜ Données hébergées EU (Railway Paris / Scalingo)
⬜ Registre des traitements (document interne)
⬜ DPO désigné (obligatoire si > 250 salariés ou traitement sensible)
⬜ Droit à l'effacement : DELETE /api/v1/users/me → supprime toutes données
⬜ Droit à la portabilité : GET /api/v1/users/me/export → ZIP JSON
⬜ Durée de conservation : logs 13 mois, transactions 10 ans (légal FR)
⬜ Consentement explicite avant création compte fidélité
⬜ Mention légale sur reçus PDF
⬜ Stripe : DPA signé (Data Processing Agreement)
⬜ Resend : DPA signé
⬜ Gemini : vérifier terms of service pour données restauration
```

### 14.3 PCI-DSS

```
⬜ Stripe Elements : aucune donnée carte sur nos serveurs
⬜ HTTPS obligatoire
⬜ Pas de logging des données de carte (audit du code)
⬜ 3D Secure via Stripe Radar (configurer rules)
⬜ Activer Stripe Radar pour détection fraude
```

---

## 15. Performance & Monitoring

### 15.1 Objectifs de performance

| Métrique | Objectif | Mesure |
|----------|----------|--------|
| LCP menu client | < 2.5s (4G) | Lighthouse |
| TTI dashboard | < 3s | Web Vitals |
| OCR PDF 10 pages | < 30s | logs backend |
| Latence streaming SSE | < 500ms premier token | logs |
| API P95 latency | < 200ms | Sentry |
| Uptime | > 99.5% | UptimeRobot |

### 15.2 Optimisations frontend

```jsx
// Lazy loading des routes :
const MenuPage = lazy(() => import('./features/client/MenuPage'));
const CheckoutPage = lazy(() => import('./features/payment/CheckoutPage'));

// Images :
// - Stocker en WebP sur R2
// - srcset + sizes pour responsive
// - Skeleton placeholder pendant chargement

// Bundle :
// - Stripe.js chargé uniquement sur pages paiement
// - Lucide icons : import individual (pas import *)
```

### 15.3 Cache strategy

```python
# Redis cache layers :
# L1 - Menu public : 5 min (invalidé à chaque modif item)
# L2 - Contexte Gemini : 1h (menu injecté dans prompt)
# L3 - Analytics summary : 15 min (recalcul coûteux)
# L4 - Google Places rating : 1h

# Cache warming : au démarrage, préchauffer les menus actifs
```

### 15.4 Monitoring & Observabilité

```python
# Sentry (erreurs + performance) :
sentry_sdk.init(
    dsn=settings.sentry_dsn,
    traces_sample_rate=0.1,   # 10% des requêtes tracées
    profiles_sample_rate=0.1,
)

# PostHog (analytics produit, hébergé EU) :
# - Funnel : upload → OCR → publication → premier scan client
# - Feature flags pour rollout progressif
# - Session recording sur dashboard restaurateur (opt-in)

# Logs structurés JSON :
import structlog
log = structlog.get_logger()
log.info("payment.succeeded", order_id=str(order_id), amount=amount)
```

---

## 16. Modèle économique

### 16.1 Plans

| Plan | Prix | Limites | Revenus |
|------|------|---------|---------|
| **Free** | 0€/mois | 1 menu, pas de paiement, pas d'analytics | - |
| **Pro** | 49€/mois | Illimité + tout | MRR direct |
| **Commission** | 0.5% par transaction | Sur paiements traités | Volume-based |

### 16.2 Projections (100 restaurants Pro)

```
MRR = 100 × 49€ = 4 900€/mois
Volume transactions (100 restos × 200€/jour × 30j) = 600 000€/mois
Commission 0.5% = 3 000€/mois
Total = ~7 900€/mois = ~95 000€/an
```

### 16.3 Levier croissance

```
- SEO local : page /[slug] indexée Google par restaurant
- Word-of-mouth : clients qui scannent voient "Propulsé par EASY.Q"
- Partenariats : associations de restaurateurs, groupements (Logis de France, etc.)
- Referral : 1 mois gratuit par restaurant référé
```

---

## 17. Récapitulatif des priorités — état 2026-04-30

> Sprints 1–5 sont **largement complétés**. Les tâches restantes sont des correctifs et la Phase 6.

### ✅ Complété (Sprints 1–5)
- OCR, éditeur, tables, QR, traduction backend, dashboard, settings, emails
- Menu client PWA, ChatWidget SSE, panier, appel serveur, allergènes
- Checkout Stripe, tip, thank-you, reçu PDF, avis Google, NPS
- KDS WebSocket, commandes chatbot function-calling, stocks
- Analytics (revenue/covers/items/chatbot/heatmap/CSV export)
- Stripe Billing (checkout/portal/webhook), UpgradePage, onboarding

### 🔴 Blockers prod à corriger en priorité
1. **`api.post` manquant** → bulk translate cassé (`api.js` + `TranslatorPage.jsx:139`)
2. **Admin auth mismatch** → dashboard admin inaccessible en prod (`api.js:243-283` + `AdminDashboardPage.jsx`)
3. **Admin `publish_status` vs `status`** → toggle et badge admin toujours faux
4. **`Base.metadata.create_all`** → retirer de `main.py:100`
5. **`asyncio.run()` dans `public.py`** → risque deadlock Uvicorn en prod

### 🟠 Améliorations sprint en cours
6. **Pro gating strict** — lever 402 si subscription absente
7. **CartContext scopé** — isolation par slug/restaurantId
8. **Health endpoint 503** — retourner 503 si DB/Redis down
9. **Supprimer duplications** — `components/ChatWidget.jsx` + `pages/CartPage.jsx`
10. **KPI admin `active_restaurants`** — corriger filtre `publish_status == "published"`

### 🟡 Sprint suivant
11. **Apple Pay / Google Pay** (`PaymentRequestButton` dans CheckoutPage)
12. **Stripe Connect** (`transfer_data` + `application_fee_amount`)
13. **E2E Playwright** (parcours scan→menu→commande→paiement)
14. **KDS path** — aligner `restaurant_id` vs slug

### ⚪ Sprint 6 — Croissance (non commencé)
15. POS Zelty / Lightspeed
16. Programme fidélité + CRM
17. Multi-établissements
18. Widget Google Places (rating menu page)

### ⚪ Sprint 6 — Croissance (semaines 16-20+)

19. Intégration POS Zelty
20. Programme fidélité + CRM
21. Multi-établissements
22. Widget Google Places

---

> **Note finale** : Le MVP Cresco valide les concepts clés (OCR, chatbot, cart).  
> EASY.Q améliore sur tous les fronts : architecture async, auth Clerk, multi-tenant, paiement réel, analytics, conformité RGPD.  
> La priorité absolue est le **flow client complet** (scan → menu → chat → panier) car c'est ce que voit l'utilisateur final.  
> Sans une expérience client fluide, le restaurateur n'a pas de raison d'adopter le produit.
