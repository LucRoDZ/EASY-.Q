# EASY.Q — Trello Audit Report
**Date:** 2026-05-02  
**Board:** [EASY .Q](https://trello.com/b/ZVmo65zA/easy-q)

---

## Summary

| Category | Count |
|---|---|
| Cards moved to Done (this session) | **20** |
| Cards already in Done (pre-existing) | **35** |
| **Total Done** | **55** |
| Cards remaining in active lists | **15** |
| Cards in archived lists (old structure, ignored) | ~40 |

---

## ✅ Cards Moved to Done (20)

These features were confirmed as fully implemented in the codebase.

### Backlog → Done
| Card | Evidence |
|---|---|
| Moyen de substitution à l'OCR google | `backend/app/services/ocr_service.py` uses PyMuPDF (`fitz`) — no Google Vision API dependency |

### Phase 2 → Done
| Card | Evidence |
|---|---|
| Recommandations IA selon goûts / allergènes | `chat_service.py` system prompt includes allergen context extraction and asks preferences before recommending |

### Phase 3 → Done
| Card | Evidence |
|---|---|
| Pourboire digital (montants présélectionnés) | `frontend/src/features/payment/TipPage.jsx` — 0/5/10/15% presets + custom amount |
| Reçu PDF par email post-paiement | `payments.py` `_send_receipt_background()` + `_build_receipt_pdf()` — PDF generated and sent via Resend |
| Demande d'avis Google post-paiement | `ThankYouPage.jsx` — NPS ≥ 9 shows Google Places `writereview` deep link |
| Questions retours utilisateurs après le paiement | `ThankYouPage.jsx` — NPSSurvey component with 0-10 scoring and optional comment |

### Phase 4 → Done
| Card | Evidence |
|---|---|
| Commande via chatbot IA → envoyée en cuisine | `orders.py` `create_order()` + `kds.py` WebSocket broadcast on order creation |
| Validation commande par le client avant envoi | `CartPage.jsx` — cart review with minimum order check before submitting |
| Bon de commande cuisine en temps réel (WebSocket) | `kds.py` — full WebSocket KDS implementation with Redis pub/sub |
| Modification commande avant validation cuisine | `orders.py` `edit_order()` + ThankYouPage countdown timer (edit window) |
| Mode scan & go (commande + paiement + emporter) | `models.py` `pickup_number` field + `_next_pickup_number()` + ThankYouPage displays pickup number |

### Phase 5 → Done
| Card | Evidence |
|---|---|
| Backoffice admin : liste restaurateurs + métriques globales | `AdminDashboardPage.jsx` — OverviewTab KPIs + RestaurantsTab list + `admin.py` endpoints |
| Admin : suspendre / activer un compte restaurateur | `admin.py` `update_restaurant_status()` + UI suspend/reactivate buttons |
| Admin : gestion des abonnements et facturation | `AdminDashboardPage.jsx` SubscriptionsTab + `subscriptions.py` full Stripe Billing integration |
| Dashboard restaurateur : CA / couverts / panier moyen | `DashboardChartsPage.jsx` — KPI cards + daily bar charts (revenue, covers, avg basket, tips) |
| Analytics : plats les plus commandés / heures de pointe | `analytics.py` `get_items_analytics()` endpoint |
| Analytics : questions fréquentes du chatbot | `analytics.py` `get_chatbot_analytics()` endpoint |
| Export comptable (CSV/JSON) clôture de caisse | `analytics.py` `export_analytics_csv()` — Sage/QuickBooks/EBP compatible semicolon-delimited CSV |

### Phase 6 → Done
| Card | Evidence |
|---|---|
| Freemium → Pro (abonnement Stripe Billing) | `SubscriptionPage.jsx` + `subscriptions.py` — Stripe Checkout + Customer Portal, 49€/month |
| Multilingue | `localization/translations.js` — EN / FR / ES + auto-translation via Gemini on menu upload |

---

## 🚧 Cards Remaining in Active Lists (15)

Features not yet implemented or only partially started.

### Phase 0 — Fondations (1)
| Card | Status | Notes |
|---|---|---|
| Dépôt de marque EASY.Q à l'INPI | ⏳ Legal task | Non-code task — requires filing classe 42 + classe 35, ~250€ |

### Phase 1 — Parcours Restaurateur (1)
| Card | Status | Notes |
|---|---|---|
| Prévisualisation PDF inline avant upload (PDF.js) | ❌ Not started | No PDF.js or react-pdf found in frontend |

### Phase 3 — Paiement à table (4)
| Card | Status | Notes |
|---|---|---|
| Partage de l'addition (par personne ou par article) | ⚠️ Backend only | `api.js` sends `split_persons`/`split_index` but no split UI in `CheckoutPage.jsx` |
| Paiement titres-restaurant (Swile / Edenred) | ❌ Not started | No Swile/Edenred integration in `payments.py` |
| Stripe Connect (versements restaurateur) | ❌ Not started | No `stripe.Account` or Connect flow found anywhere |
| Certification PCI-DSS + 3D Secure (DSP2) | ⚠️ Implicit only | Stripe Elements = PCI-DSS SAQ-A compliant by default; no explicit Stripe Radar 3DS rule configured |
| Onboarding Stripe Connect restaurateur (Account Link) | ❌ Not started | Depends on Stripe Connect above |

### Phase 4 — Commande à table (2)
| Card | Status | Notes |
|---|---|---|
| Gestion ruptures de stock en temps réel | ❌ Not started | No `available`/`stock` field on `MenuItem` model |
| Statut commande visible par le client (en préparation / prête) | ⚠️ Partial | ThankYouPage shows pickup number and edit countdown but no real-time KDS status feed to client |

### Phase 5 — Analytics & Admin (1)
| Card | Status | Notes |
|---|---|---|
| Rapport pourboires par serveur | ❌ Not started | No waiter/server entity model; tip data is per-payment only |

### Phase 6 — Croissance (6)
| Card | Status | Notes |
|---|---|---|
| Intégration POS léger (Zelty API ou Lightspeed) | ❌ Not started | No POS connector |
| Programme de fidélité client (compte optionnel) | ❌ Not started | No loyalty model |
| CRM restaurateur : historique client / fréquence | ❌ Not started | No customer tracking model |
| Widget avis Google / TripAdvisor intégré | ❌ Not started | Google review link exists in ThankYouPage but no embeddable widget |
| Mode multi-établissements (groupes de restaurants) | ❌ Not started | 1:1 restaurant/account model only |

---

## 📋 Board Structure

| List | Cards (after audit) |
|---|---|
| Backlog | 0 |
| Phase 0 — Fondations | 1 |
| Phase 1 — Parcours Restaurateur | 1 |
| Phase 2 — Parcours Client | 0 |
| Phase 3 — Paiement à table | 5 |
| Phase 4 — Commande à table | 2 |
| Phase 5 — Analytics & Admin | 1 |
| Phase 6 — Croissance | 6 |
| **Done** | **~55** |

---

## 🎯 Recommended Next Priorities

Based on the remaining work, the highest-impact items to complete the core product are:

1. **Split bill UI** (Phase 3) — backend is ready, just needs `CheckoutPage.jsx` UI
2. **Client order status feed** (Phase 4) — add SSE or polling to show "en préparation / prêt" in ThankYouPage
3. **PDF preview on upload** (Phase 1) — quick win with `react-pdf`
4. **Stock management** (Phase 4) — add `available: bool` to MenuItem and expose toggle in editor
5. **Stripe Connect** (Phase 3) — required to properly monetize; blocks both the onboarding card and tip-per-server

Items like POS integration, loyalty program, and multi-establishment are correctly deferred to Phase 6 (post-launch growth).
