# EASY.Q Fix Plan — Implementation Roadmap

> **Ralph's task tracker** — ONE task per loop, top to bottom
> Generated: 2026-04-08
> Based on: REBUILD_ROADMAP.md + current codebase state

---

## Phase 0 — Foundations ✅

All infrastructure components are in place:

- ✅ Redis configuration (`backend/app/core/redis.py`)
- ✅ Cloudflare R2 storage (`backend/app/core/storage.py`)
- ✅ Database models: Menu, Conversation, Subscription, ChatSession, Table, RestaurantProfile, Payment, AuditLog
- ✅ Migrations: 001 (initial), 002 (menu status), 003 (tables)
- ✅ Auth: Clerk integration
- ✅ i18n: FR/EN/ES translations
- ✅ Cookie consent banner (RGPD)
- ✅ Rate limiting (slowapi)

### Missing from Phase 0

- ✅ Create migration 004 for missing tables: restaurant_profiles, payments (subscriptions, chat_sessions, audit_logs were already in 001)
- ✅ Add AuditLog service with helper functions (log_action, query_logs, convenience helpers)
- ✅ Verify all environment variables are documented in .env.example
- ✅ Create health check endpoint `/api/v1/health` (check DB, Redis, R2 connectivity)

---

## Phase 1 — Parcours Restaurateur

### 1.1 Upload & OCR

- ✅ Frontend: OCRUploadPage.jsx exists
- ✅ Backend: POST /api/v1/menus/upload exists
- ✅ OCR service with Gemini Vision exists

- ✅ **Test OCR flow end-to-end** — upload PDF → OCR processing → menu ready
- ✅ Add retry logic for failed OCR (max 3 attempts with exponential backoff)
[x] Add support for image upload (JPG/PNG) in addition to PDF
[x] Add OCR result validation with Pydantic schema
[x] Implement OCR cache using Redis (key: PDF sha256, TTL: 24h)

### 1.2 Menu Editor

- ✅ Frontend: MenuEditorPage.jsx exists
- ✅ Backend: PATCH /api/v1/menus/{id} exists

[x] **Test menu editor** — edit sections, items, prices, allergens, tags
[x] Add drag-and-drop reordering for sections and items
[x] Add AllergenIcons component with all 14 EU allergens
[x] Add real-time preview panel (mobile view)
[x] Add menu versioning (save drafts vs published)
[x] Add menu duplication feature

### 1.3 Translation

- ✅ Frontend: TranslatorPage.jsx exists
- ✅ Backend: POST /api/v1/menus/translate exists

[ ] **Test translation flow** — translate FR→EN, FR→ES
[ ] Add translation memory (cache common translations)
[ ] Add bulk translate button (entire menu at once)
[ ] Add manual override for AI translations
[ ] Store translations in Menu.menu_data JSONB (not separate table)

### 1.4 Restaurant Settings

- ✅ Frontend: RestaurantSettingsPage.jsx exists
- ✅ Backend: GET/PATCH /api/v1/restaurants/{slug} exists

[ ] **Test restaurant settings** — update name, address, phone, hours, logo
[ ] Add logo upload with image resize/optimize (max 500KB, 512x512px)
[ ] Add opening hours editor (7 days, open/close times, closed toggle)
[ ] Add timezone selector
[ ] Add social media links (Instagram, Facebook, Google Maps)

### 1.5 Tables & QR Codes

- ✅ Frontend: TablesPage.jsx exists
- ✅ Backend: POST /api/v1/tables/bulk, GET /api/v1/tables exists
- ✅ QR service exists

[ ] **Test table creation** — bulk create 10 tables, generate QR codes
[ ] Add table layout visual editor (drag-and-drop floor plan)
[ ] Add QR code PDF export for printing (all tables, 6 per page)
[ ] Add QR code customization (logo overlay, colors)
[ ] Add table status tracking (occupied, reserved, available)

---

## Phase 2 — Parcours Client (Menu Digital)

### 2.1 Public Menu View

- ✅ Frontend: MenuPage.jsx exists (in both src/pages and src/features/client)
- ✅ Backend: GET /api/v1/public/menu/{slug} exists

[ ] **Consolidate duplicate MenuPage** — move src/pages/MenuPage.jsx to src/features/client, remove duplicate
[ ] Test menu view — sections, items, allergens, prices
[ ] Add CartSummaryBar sticky bottom bar
[ ] Add floating language selector (FR/EN/ES)
[ ] Add menu search/filter (vegetarian, vegan, allergen-free)
[ ] Add item detail modal (full description, nutrition info)
[ ] Implement PWA manifest and service worker
[ ] Add "Add to Home Screen" prompt

### 2.2 Cart & Checkout

- ✅ Frontend: CartPage.jsx exists (in src/pages)
- [ ] Backend: POST /api/v1/orders missing

[ ] **Move CartPage** — src/pages/CartPage.jsx → src/features/client/CartPage.jsx
[ ] Test cart — add items, modify quantities, add notes per item
[ ] Add cart persistence (localStorage + BroadcastChannel for multi-tab sync)
[ ] Display VAT breakdown (10% food, 20% alcohol)
[ ] Add cart validation (min order amount, availability check)
[ ] Create Order model (table_id, items JSONB, status, total, created_at)
[ ] Create POST /api/v1/orders endpoint

### 2.3 AI Chatbot

- ✅ Frontend: ChatWidget.jsx exists (in both src/components and src/features/client)
- ✅ Backend: POST /api/v1/public/chat (SSE streaming) exists

[ ] **Consolidate duplicate ChatWidget** — keep src/features/client version, remove src/components
[ ] Test chatbot — ask questions, get menu recommendations
[ ] Implement Redis session storage (TTL 2h)
[ ] Add chatbot context (menu + allergens + dietary preferences)
[ ] Add multi-language support (detect user language, respond in same language)
[ ] Add chat history persistence (last 10 messages)
[ ] Add suggested questions UI
[ ] Add typing indicator and smooth streaming

### 2.4 Waiter Call

- ✅ Backend: POST /api/v1/public/waiter/call exists
- [ ] Frontend: WaiterCallButton missing

[ ] Create WaiterCallButton component (FAB, bottom-right)
[ ] Test waiter call — send call, view in dashboard
[ ] Add call status tracking (pending, acknowledged, resolved)
[ ] Add call history for table
[ ] Implement Redis pub/sub for real-time notifications to restaurant dashboard

---

## Phase 3 — Paiement à Table

### 3.1 Tip Selection

[ ] Create TipPage.jsx — preset amounts (5%, 10%, 15%, custom)
[ ] Add "No tip" option
[ ] Store tip_amount in Payment model
[ ] Update cart total calculation to include tip

### 3.2 Checkout Flow

- ✅ Frontend: CheckoutPage.jsx exists
- ✅ Backend: POST /api/v1/payments/create-intent exists

[ ] Test checkout — Stripe Elements, card payment
[ ] Add Apple Pay / Google Pay support
[ ] Add payment loading states and error handling
[ ] Add payment confirmation animation
[ ] Implement Stripe webhook handler (/api/v1/payments/webhook)
[ ] Add payment receipt email (Resend)
[ ] Add payment receipt PDF generation

### 3.3 Bill Splitting

[ ] Create SplitBillPage.jsx — split by person, by item, or custom
[ ] Add split payment UI (multiple people pay separately)
[ ] Create multiple PaymentIntents for split bills
[ ] Add split payment tracking in Order model
[ ] Test split payment flow end-to-end

### 3.4 Thank You & Review

[ ] Create ThankYouPage.jsx — payment success, NPS survey
[ ] Add NPS question (1-10 scale: "Would you recommend this restaurant?")
[ ] Add optional open-ended feedback textarea
[ ] Store feedback in AuditLog or new Feedback model
[ ] Add Google review link (if rating >= 9)
[ ] Send email to restaurant if NPS < 7
[ ] Add review analytics to restaurant dashboard

---

## Phase 4 — Commande à Table (KDS)

### 4.1 Order Placement via Chatbot

[ ] Add Gemini function calling for "place_order"
[ ] Create Order and OrderItem models
[ ] Create POST /api/v1/orders endpoint (from chatbot function call)
[ ] Add order confirmation message in chat
[ ] Add order notification to kitchen (Redis pub/sub)

### 4.2 Kitchen Display System (KDS)

[ ] Create KitchenScreen.jsx — WebSocket real-time orders
[ ] Add KDS auth (simple token, not Clerk)
[ ] Create WebSocket endpoint /api/v1/ws/kds/{restaurant_id}
[ ] Implement KDSConnectionManager for WebSocket connections
[ ] Add Kanban columns: Pending → In Progress → Ready → Completed
[ ] Add order timer (highlight red if > 15min)
[ ] Add sound alert for new orders
[ ] Add order status updates (click to move between columns)
[ ] Add auto-reconnect for WebSocket failures
[ ] Test KDS with multiple concurrent orders

### 4.3 Order Modification Window

[ ] Add 2-minute edit window for orders (status: "pending")
[ ] After 2min, lock order (status: "confirmed")
[ ] Add PATCH /api/v1/orders/{id} — only if status == "pending"
[ ] Return 409 Conflict if order locked
[ ] Show countdown timer in client UI

### 4.4 Scan & Go Mode

[ ] Add support for orders without table_id (takeout/pickup)
[ ] Generate pickup number (incremental counter per day per restaurant)
[ ] Add separate KDS column for takeout orders
[ ] Add pickup number display in ThankYouPage
[ ] Test Scan & Go flow — QR scan → order → pay → pickup number

---

## Phase 5 — Analytics & Admin

### 5.1 Restaurant Analytics

[ ] Create DashboardChartsPage.jsx — revenue, covers, chatbot usage
[ ] Add date range picker (today, week, month, custom)
[ ] Add revenue chart (daily/weekly breakdown)
[ ] Add covers chart (number of tables served)
[ ] Add chatbot metrics (messages, sessions, avg duration)
[ ] Add top items sold chart
[ ] Add peak hours heatmap
[ ] Backend: GET /api/v1/analytics/revenue
[ ] Backend: GET /api/v1/analytics/covers
[ ] Backend: GET /api/v1/analytics/chatbot
[ ] Backend: GET /api/v1/analytics/items

### 5.2 Conversations Dashboard

- ✅ Frontend: DashboardConversationsPage.jsx exists
- ✅ Backend: GET /api/dashboard/conversations exists

[ ] Test conversations dashboard — list all chat sessions
[ ] Add conversation search/filter
[ ] Add conversation export (CSV)
[ ] Add sentiment analysis (positive/negative feedback detection)

### 5.3 Admin Backoffice

[ ] Create AdminDashboardPage.jsx — superadmin panel
[ ] Add user management (list, toggle active, delete)
[ ] Add restaurant management (list, view details, deactivate)
[ ] Add subscription management (view plans, cancel, refund)
[ ] Add system health metrics (DB, Redis, R2 status)
[ ] Add audit log viewer (filter by actor, action, resource)
[ ] Backend: GET /api/v1/admin/users
[ ] Backend: GET /api/v1/admin/restaurants
[ ] Backend: GET /api/v1/admin/subscriptions
[ ] Backend: GET /api/v1/admin/audit-logs

---

## Phase 6 — Croissance & Monétisation

### 6.1 Subscription Management

[ ] Create UpgradePage.jsx — Freemium vs Pro comparison
[ ] Add Stripe Billing integration
[ ] Create POST /api/v1/subscriptions/create-checkout endpoint
[ ] Add Stripe Customer Portal link
[ ] Add subscription webhook handler
[ ] Add plan limits enforcement (free: 1 menu, pro: unlimited)
[ ] Add feature gating (payment, analytics only in Pro)

### 6.2 Onboarding Flow

[ ] Create multi-step onboarding wizard (restaurant info → upload menu → create tables)
[ ] Add progress tracker (3 steps)
[ ] Add sample data option (skip OCR, use demo menu)
[ ] Add onboarding completion celebration (confetti animation)
[ ] Track onboarding completion in AuditLog

### 6.3 Email Notifications

[ ] Set up Resend templates
[ ] Add welcome email (onboarding)
[ ] Add payment receipt email
[ ] Add low NPS alert email (score < 7)
[ ] Add weekly digest email (restaurant analytics summary)
[ ] Add order confirmation email (optional)

---

## Phase 7 — Testing & Quality

### 7.1 Backend Tests

[ ] Add pytest fixtures for DB, Redis, mocked Gemini API
[ ] Test auth endpoints (Clerk webhook, /me)
[ ] Test menu endpoints (upload, OCR, edit, translate)
[ ] Test table endpoints (create, list, QR generation)
[ ] Test payment endpoints (create intent, webhook)
[ ] Test chat endpoints (SSE streaming, session storage)
[ ] Test KDS WebSocket connections
[ ] Achieve 80%+ backend code coverage

### 7.2 Frontend Tests

[ ] Add Vitest + React Testing Library tests
[ ] Test MenuPage rendering and interaction
[ ] Test CartContext add/remove/update
[ ] Test ChatWidget streaming and session management
[ ] Test payment form validation
[ ] Test KDS WebSocket reconnection
[ ] Add Playwright E2E tests (critical paths)
[ ] Achieve 70%+ frontend code coverage

---

## Phase 8 — Performance & Monitoring

### 8.1 Performance Optimization

[ ] Add Redis caching for menu queries (5min TTL)
[ ] Add Redis caching for OCR results (24h TTL)
[ ] Optimize menu query with DB indexes
[ ] Add lazy loading for menu images
[ ] Add image CDN (Cloudflare or Cloudinary)
[ ] Optimize bundle size (code splitting, tree shaking)
[ ] Add Lighthouse CI to check PWA score (target: 90+)

### 8.2 Monitoring & Logging

[ ] Set up Sentry for error tracking (backend + frontend)
[ ] Add PostHog for product analytics (RGPD compliant)
[ ] Add structured logging (JSON format, log levels)
[ ] Add request ID tracing (X-Request-ID header)
[ ] Add slow query logging (> 100ms)
[ ] Add uptime monitoring (UptimeRobot or similar)
[ ] Add performance monitoring (APM)

---

## Current Priority: Backend Infrastructure

**COMPLETED**:
- ✅ Migration 004 created for restaurant_profiles and payments tables
- ✅ AuditLog service with comprehensive helpers and tests
- ✅ Environment variables documented in backend/.env.example

**NEXT TASK**: Create health check endpoint `/api/v1/health` (check DB, Redis, R2 connectivity)
