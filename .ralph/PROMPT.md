# Ralph — EASY.Q Agent Instructions

## Stack
React 18 + Vite + Tailwind | FastAPI Python 3.12 + SQLAlchemy + Alembic + PostgreSQL | Clerk JWT | Gemini 2.5 Flash | Stripe | Redis | Resend | Cloudflare R2

**Root:** `/home/lucas/PERSO/easyq/EASY-.Q/` · Backend: `backend/app/` · Frontend: `frontend/src/`

## Execution Rules
1. **Start each loop by reading `.ralph/CHECKPOINT.md`** — if it says "Active Sprint", read `.ralph/GOALS.md` next
2. If GOALS.md exists, pick the first goal marked `[ ]` and execute it completely — one goal per session
3. Mark the goal `[x]` in GOALS.md when done, update CHECKPOINT.md, commit, then exit
4. If no GOALS.md or all goals are done, pick the highest-priority remaining item from CHECKPOINT.md (🔴 first, then 🟠, then 🟡)
5. Do **3–5 tasks per loop** — never stop after one
6. Read a file before editing it; prefer editing over creating new files
7. Consult `.ralph/fix_plan.md` only when you need the full spec of a specific task

## Priority Order (STRICT — follow this, do not deviate)

### Tier 1 — Fix broken/partial features first
These are working features with bugs that break them in production. Fix these before any new work.

Current 🔴 blockers (in order):
1. **api.post missing** — add `async post(url, body)` to `frontend/src/api.js` after `patch`
2. **Admin auth mismatch** — `getAdminStats/getAdminRestaurants/etc.` must send `Authorization: Bearer` Clerk token; remove legacy `adminStats/adminRestaurants/adminSubscriptions/adminAuditLogs` methods that use `X-Admin-Token`
3. **Admin publish_status mismatch** — replace `r.status` → `r.publish_status` in `AdminDashboardPage.jsx:154,171,189`
4. **`Base.metadata.create_all`** — remove line from `backend/app/main.py:100`
5. **`asyncio.run()` in public.py** — make endpoints async, replace `asyncio.run(...)` with `await ...` at lines 43,51,62,76,163

Current 🟠 fixes:
6. **Pro gating** — raise `HTTPException(402)` in `require_pro` when subscription absent
7. **CartContext scope** — key localStorage by `slug` so carts don't bleed between restaurants
8. **Health 503** — return HTTP 503 (not 200) when DB or Redis is down
9. **Admin KPI** — fix `Menu.status == "active"` → `Menu.publish_status == "published"` in `admin.py:57`

### Tier 2 — New features (only after all Tier 1 is clear)
Implement in roadmap priority order:
- Apple Pay / Google Pay (`PaymentRequestButton` in `CheckoutPage.jsx`)
- Stripe Connect (`transfer_data` + `application_fee_amount` in payments.py)
- Scan & Go mode (table_id=null, retrait number per day)
- Google Places widget (rating on client menu page)

### Tier 3 — Tests
Only write tests for features that are **complete and passing**. Never block feature work to add coverage. The test suite is already at 404 backend / 111 frontend — good enough to ship. Add tests when a Tier 1 or Tier 2 feature is finished, not before.

### Tier 4 — CI / Infrastructure
Do not touch CI, linting, or infrastructure unless a feature explicitly requires it. The pipeline is already green.

## What NOT to do
- Do not run the full test suite as your primary loop task
- Do not improve test coverage on already-working code
- Do not add linting passes, ruff fixes, or mypy runs as standalone tasks
- Do not refactor working code "for cleanliness" — only touch files related to the current task
- Do not write E2E tests (Playwright) before the Tier 1 bugs are fixed

## Tailwind Constraints
- ONLY neutral/black/white — no custom colors, no `primary-*`
- Cards: `bg-white rounded-xl shadow-sm border border-neutral-200`
- Buttons: `bg-black text-white rounded-full hover:bg-neutral-800`
- Header: `bg-black text-white sticky top-0 z-40`

## Protected Files (DO NOT TOUCH)
`.ralph/` · `.ralphrc` · `.mcp.json` · `REBUILD_ROADMAP.md`

## Test Commands
```bash
# Backend — targeted (preferred, keeps context small)
cd backend && .venv/bin/python -m pytest tests/test_<affected>.py -q --tb=short

# Backend — full suite only when explicitly asked
cd backend && .venv/bin/python -m pytest -q --tb=short

# Frontend
cd frontend && npx vitest run --reporter=dot
```

## Read discipline (token efficiency)
- Use Grep to find the exact lines before Read — never read a whole file to find one function
- Use `Read` with `offset` + `limit` when you know which section you need
- Never read `requirements.txt`, `package-lock.json`, or test fixtures unless directly editing them
- Never run the full test suite as a loop task — only run tests for files you just changed

## Status Block (REQUIRED at end of every response)
```
---RALPH_STATUS---
STATUS: IN_PROGRESS|COMPLETE|BLOCKED
TASKS_DONE: <n>
FILES_CHANGED: <n>
TESTS: PASSING|FAILING|NOT_RUN
NEXT: <one-line description of next task>
EXIT_SIGNAL: false
---END_RALPH_STATUS---
```
EXIT_SIGNAL is ALWAYS `false` — there are always more tasks.
