# EASY.Q — Deployment Setup Guide for easy.fr

> **Domain purchased:** easy.fr on OVHCloud  
> **Last updated:** 2026-05-19

This guide walks through every service you need to connect, in the order you should do them. For each service, you'll find: the URL, where to click, what to copy, and where to paste it.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [OVHCloud — DNS Setup](#2-ovhcloud--dns-setup)
3. [Railway — Backend + Database + Redis](#3-railway--backend--database--redis)
4. [Vercel — Frontend Deployment](#4-vercel--frontend-deployment)
5. [Clerk — Authentication](#5-clerk--authentication)
6. [Stripe — Payments + Subscriptions + Connect](#6-stripe--payments--subscriptions--connect)
7. [Cloudflare R2 — File Storage](#7-cloudflare-r2--file-storage)
8. [Resend — Transactional Email](#8-resend--transactional-email)
9. [Google Gemini — AI / OCR](#9-google-gemini--ai--ocr)
10. [Final ENV Checklist](#10-final-env-checklist)
11. [Webhook URLs Summary](#11-webhook-urls-summary)

---

## 1. Architecture Overview

```
easy.fr            → Vercel (React frontend)
api.easy.fr        → Railway (FastAPI backend)
cdn.easy.fr        → Cloudflare R2 (images/PDFs)
```

| Layer | Service | URL | Free tier | Paid |
|-------|---------|-----|-----------|------|
| Frontend | Vercel | vercel.com | ✅ Free (hobby) | $20/mo (Pro) |
| Backend | Railway | railway.app | $5 credit/mo | ~$10–20/mo (usage-based) |
| Database | Railway PostgreSQL | railway.app | included above | included above |
| Cache | Railway Redis | railway.app | included above | included above |
| Auth | Clerk | clerk.com | ✅ Free (10k MAU) | $25/mo (Pro) |
| Payments | Stripe | stripe.com | ✅ No monthly fee | 1.5% + €0.25/tx (EU cards) |
| Storage | Cloudflare R2 | cloudflare.com | ✅ Free (10 GB, 1M ops) | $0.015/GB/mo |
| Email | Resend | resend.com | ✅ Free (3k emails/mo) | $20/mo (50k emails) |
| AI | Google Gemini | aistudio.google.com | ✅ Free tier | ~$0.10/1M tokens (flash-lite) |

---

## 2. OVHCloud — DNS Setup

**URL:** https://www.ovhcloud.com/manager  
**Goal:** Point easy.fr to Vercel (frontend) and api.easy.fr to Railway (backend)

### Step-by-step

1. Log in at https://www.ovhcloud.com/manager
2. Click **"Web Cloud"** in the top menu
3. Click **"Domain names"** in the left sidebar
4. Click **easy.fr** in the list
5. Click the **"DNS zone"** tab

### DNS Records to add

Click **"Add an entry"** for each record below:

#### Frontend (Vercel)
| Type | Subdomain | Target | TTL |
|------|-----------|--------|-----|
| CNAME | `www` | `cname.vercel-dns.com.` | 3600 |
| A | `@` (root) | `76.76.21.21` | 3600 |

> Note: Get the exact Vercel IP/CNAME from **Step 4** — Vercel shows it during domain setup.

#### Backend (Railway)
| Type | Subdomain | Target | TTL |
|------|-----------|--------|-----|
| CNAME | `api` | `<your-railway-service>.up.railway.app.` | 3600 |

> Note: Get the Railway hostname from **Step 3** — Railway shows it after you deploy.

#### CDN (Cloudflare R2 — optional custom domain)
| Type | Subdomain | Target | TTL |
|------|-----------|--------|-----|
| CNAME | `cdn` | `<bucket>.r2.cloudflarestorage.com.` | 3600 |

> Note: Get the R2 bucket hostname from **Step 7**.

### After adding DNS
- DNS propagation takes 5–60 minutes
- Check with: https://dnschecker.org/#A/easy.fr

---

## 3. Railway — Backend + Database + Redis

**URL:** https://railway.app  
**Goal:** Deploy the FastAPI backend, create a PostgreSQL database, create a Redis instance

### 3.1 Create a new project

1. Go to https://railway.app and click **"Start a New Project"**
2. Click **"Deploy from GitHub repo"**
3. Connect your GitHub account if not already connected
4. Select the **EASY-.Q** repository
5. Railway will detect Python — click **"Deploy"**

### 3.2 Configure the service

1. In the Railway dashboard, click your service (the Python app)
2. Click **"Settings"** tab
3. Under **"Root Directory"** type: `backend`
4. Under **"Start Command"** type:
   ```
   uvicorn app.main:app --host 0.0.0.0 --port $PORT
   ```
5. Click **"Save"**

### 3.3 Add PostgreSQL

1. In your Railway project, click **"+ New"**
2. Click **"Database"** → **"Add PostgreSQL"**
3. Wait for provisioning (~30 seconds)
4. Click the PostgreSQL service → **"Variables"** tab
5. Copy the value of **`DATABASE_URL`**
   - It will look like: `postgresql://postgres:password@...railway.internal:5432/railway`
   - Change `postgresql://` to `postgresql+asyncpg://` before pasting into your backend env

### 3.4 Add Redis

1. In your Railway project, click **"+ New"**
2. Click **"Database"** → **"Add Redis"**
3. Wait for provisioning
4. Click the Redis service → **"Variables"** tab
5. Copy the value of **`REDIS_URL`**

### 3.5 Set environment variables on the backend service

1. Click your Python backend service
2. Click the **"Variables"** tab
3. Click **"RAW Editor"** (top right) and paste all your env vars at once (see Section 13 for the full list)

### 3.6 Set up a custom domain

1. Click your backend service → **"Settings"** tab
2. Under **"Networking"**, click **"Generate Domain"** (to get the `.up.railway.app` URL first)
3. Then click **"+ Custom Domain"**
4. Type: `api.easy.fr`
5. Copy the **CNAME target** Railway shows you
6. Go back to OVHCloud and add the `api` CNAME with that target (see Section 2)

### 3.7 Run database migrations

After the first deploy, open the Railway shell:
1. Click your backend service → **"Deploy"** tab → click the latest deploy
2. Click **"View Logs"** — verify the app started
3. Click **"Shell"** (if available) or use Railway CLI:
   ```bash
   railway run alembic upgrade head
   ```

---

## 4. Vercel — Frontend Deployment

**URL:** https://vercel.com  
**Goal:** Deploy the React (Vite) frontend and serve it at easy.fr

### 4.1 Import the project

1. Go to https://vercel.com and sign in
2. Click **"Add New..."** → **"Project"**
3. Click **"Import Git Repository"**
4. Select your **EASY-.Q** repository
5. Under **"Root Directory"**, click **"Edit"** and type: `frontend`
6. Under **"Framework Preset"** — Vercel should auto-detect **Vite**
7. Click **"Deploy"**

### 4.2 Set environment variables

1. After deploy, click **"Settings"** tab
2. Click **"Environment Variables"** in the left sidebar
3. Add each of these (click **"Add"** for each):

| Name | Value |
|------|-------|
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_live_...` (from Clerk — see Section 5) |
| `VITE_API_URL` | `https://api.easy.fr` |
| `VITE_WS_URL` | `wss://api.easy.fr` |

4. Click **"Redeploy"** to apply the variables

### 4.3 Add custom domain

1. Click **"Settings"** → **"Domains"**
2. Click **"Add Domain"**
3. Type: `easy.fr` → click **"Add"**
4. Vercel shows you the DNS records to set:
   - For the root `@`: An **A record** pointing to `76.76.21.21`
   - For `www`: A **CNAME** pointing to `cname.vercel-dns.com`
5. Go to OVHCloud and add those records (see Section 2)
6. Also add: `www.easy.fr` → repeat and add `www` as a second domain

### 4.4 Enable HTTPS

Vercel auto-provisions SSL via Let's Encrypt once DNS propagates. No action needed.

---

## 5. Clerk — Authentication

**URL:** https://dashboard.clerk.com  
**Goal:** Create an application, get API keys, configure webhooks, set up allowed domains

### 5.1 Create an application

1. Go to https://dashboard.clerk.com
2. Click **"Create application"**
3. Name it: `EASY.Q` or `easy.fr`
4. Choose sign-in methods: at minimum enable **Email + Password**
5. Click **"Create application"**

### 5.2 Get your API keys

1. In the left sidebar, click **"API Keys"**
2. Copy **"Publishable key"** — starts with `pk_live_...`
   - → This goes into: `VITE_CLERK_PUBLISHABLE_KEY` (frontend env on Vercel)
3. Copy **"Secret key"** — starts with `sk_live_...`
   - → This goes into: `CLERK_SECRET_KEY` (backend env on Railway)

### 5.3 Get the JWKS URL

1. Still on **"API Keys"** page
2. Scroll down to **"JWT verification"**
3. Copy the **JWKS URL** — looks like: `https://xxxx.clerk.accounts.dev/.well-known/jwks.json`
   - → This goes into: `CLERK_JWKS_URL` (backend env on Railway)

### 5.4 Configure allowed origins

1. In the left sidebar, click **"JWT Templates"** (skip if you don't need custom claims)
2. In the left sidebar, click **"Paths"** → **"Allowed redirect URLs"**
3. Add: `https://easy.fr`
4. Add: `https://www.easy.fr`

### 5.5 Set up the Clerk webhook

1. In the left sidebar, click **"Webhooks"**
2. Click **"Add Endpoint"**
3. In **"Endpoint URL"** type: `https://api.easy.fr/api/v1/auth/webhook`
4. Under **"Message Filtering"**, select these events:
   - `user.created`
   - `user.updated`
   - `user.deleted`
5. Click **"Create"**
6. On the webhook detail page, click **"Signing Secret"** → click the eye icon to reveal
7. Copy the value — starts with `whsec_...`
   - → This goes into: `CLERK_WEBHOOK_SECRET` (backend env on Railway)

### 5.6 Set your admin user ID

1. In the left sidebar, click **"Users"**
2. Sign up on your own app at https://easy.fr — create your owner account
3. Come back to Clerk dashboard → click **"Users"**
4. Find yourself → click your user
5. Copy the **"User ID"** — starts with `user_...`
   - → This goes into: `ADMIN_USER_IDS` (backend env on Railway)
   - If multiple admins, comma-separate: `user_abc,user_def`

---

## 6. Stripe — Payments + Subscriptions + Connect

**URL:** https://dashboard.stripe.com  
**Goal:** Get API keys, create the Pro subscription product, set up 3 webhooks, enable Connect

### 6.1 Get API keys

1. Go to https://dashboard.stripe.com
2. In the left sidebar, click **"Developers"** → **"API keys"**
3. Copy **"Publishable key"** — starts with `pk_live_...`
   - → This goes into: `STRIPE_PUBLISHABLE_KEY` (backend env on Railway)
4. Copy **"Secret key"** — click **"Reveal live key"** — starts with `sk_live_...`
   - → This goes into: `STRIPE_SECRET_KEY` (backend env on Railway)

> **Important:** Toggle from "Test mode" to "Live mode" using the toggle in the top-left before copying live keys.

### 6.2 Create the Pro subscription product

1. In the left sidebar, click **"Product catalog"**
2. Click **"+ Add product"**
3. Name: `EASY.Q Pro`
4. Click **"Add a price"**:
   - Pricing model: **Recurring**
   - Price: your monthly amount (e.g., `29.00 EUR`)
   - Billing period: **Monthly**
5. Click **"Save product"**
6. On the product page, click the price → copy the **Price ID** — starts with `price_...`
   - → This goes into: `STRIPE_PRO_PRICE_ID` (backend env on Railway)

### 6.3 Set up Stripe Connect (for restaurant payouts)

1. In the left sidebar, click **"Settings"** → **"Connect"**
2. Click **"Get started"** if not enabled
3. Under **"Integration type"**, select **"Standard"** (restaurants have their own Stripe accounts)
4. Fill in your platform details
5. Go back to **"Developers"** → **"API keys"**
6. Copy the **"Client ID"** under Connect — starts with `ca_...`
   - → This goes into: `STRIPE_CONNECT_CLIENT_ID` (backend env on Railway)

### 6.4 Webhook 1 — Payment webhook

1. In the left sidebar, click **"Developers"** → **"Webhooks"**
2. Click **"+ Add endpoint"**
3. Endpoint URL: `https://api.easy.fr/api/v1/payments/webhook`
4. Click **"Select events"** → add:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
5. Click **"Add endpoint"**
6. On the webhook page, click **"Signing secret"** → click **"Reveal"**
7. Copy the value — starts with `whsec_...`
   - → This goes into: `STRIPE_WEBHOOK_SECRET` (backend env on Railway)

### 6.5 Webhook 2 — Billing/subscription webhook

1. Still on **"Webhooks"** page, click **"+ Add endpoint"** again
2. Endpoint URL: `https://api.easy.fr/api/v1/subscriptions/webhook`
3. Click **"Select events"** → add:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Click **"Add endpoint"**
5. Reveal and copy the signing secret
   - → This goes into: `STRIPE_BILLING_WEBHOOK_SECRET` (backend env on Railway)

### 6.6 Platform fee

Set the fee you want to take from each transaction processed via Connect:
- Default is `0.03` (3%)
- → This goes into: `STRIPE_PLATFORM_FEE_PERCENT` (backend env on Railway)

---

## 7. Cloudflare R2 — File Storage

**URL:** https://dash.cloudflare.com  
**Goal:** Create an R2 bucket, get API credentials, optionally bind to cdn.easy.fr

### 7.1 Enable R2

1. Go to https://dash.cloudflare.com
2. In the left sidebar, click **"R2 Object Storage"**
3. If not enabled, click **"Purchase R2"** (free tier: 10GB storage, 1M Class A ops/month)

### 7.2 Create a bucket

1. Click **"Create bucket"**
2. Name: `easyq` (must match `R2_BUCKET_NAME` env var)
3. Location: choose **EU (Europe)** for GDPR compliance
4. Click **"Create bucket"**

### 7.3 Get the endpoint URL

1. Click your `easyq` bucket
2. Click **"Settings"** tab
3. Under **"Bucket Details"**, find **"S3 API"** — copy the URL
   - It looks like: `https://<account_id>.r2.cloudflarestorage.com`
   - → This goes into: `R2_ENDPOINT_URL` (backend env on Railway)

### 7.4 Create an API token

1. In the left sidebar (top-level), click **"R2 Object Storage"**
2. Click **"Manage R2 API Tokens"** (top right)
3. Click **"Create API token"**
4. Token name: `easyq-backend`
5. Permissions: **Object Read & Write**
6. Specify bucket: select `easyq`
7. Click **"Create API token"**
8. **IMPORTANT:** Copy both values NOW — they are shown only once:
   - **Access Key ID** → `R2_ACCESS_KEY_ID`
   - **Secret Access Key** → `R2_SECRET_ACCESS_KEY`

### 7.5 (Optional) Custom domain cdn.easy.fr

1. On the `easyq` bucket page, click **"Settings"** tab
2. Under **"Custom Domains"**, click **"Connect Domain"**
3. Type: `cdn.easy.fr`
4. Cloudflare shows you the CNAME to add to OVHCloud
5. Add that CNAME in OVHCloud DNS (see Section 2)
6. Once verified, copy the custom domain URL: `https://cdn.easy.fr`
   - → This goes into: `R2_PUBLIC_URL` (backend env on Railway)

---

## 8. Resend — Transactional Email

**URL:** https://resend.com  
**Goal:** Verify your sending domain, get API key, configure sender address

### 8.1 Create an account

1. Go to https://resend.com and sign up
2. Verify your email

### 8.2 Add and verify your domain

1. In the left sidebar, click **"Domains"**
2. Click **"Add Domain"**
3. Type: `easy.fr`
4. Click **"Add"**
5. Resend shows you DNS records to add in OVHCloud:
   - Usually 2–3 TXT records (SPF, DKIM)
   - Go to OVHCloud DNS zone and add them (see Section 2)
6. Click **"Verify DNS Records"** — wait for green checkmarks (can take a few minutes)

### 8.3 Get API key

1. In the left sidebar, click **"API Keys"**
2. Click **"Create API Key"**
3. Name: `easyq-production`
4. Permission: **Full access** (or **Sending access** is sufficient)
5. Click **"Add"**
6. Copy the key — starts with `re_...` — shown only once
   - → This goes into: `RESEND_API_KEY` (backend env on Railway)

### 8.4 Set sender address

Set `RESEND_FROM_EMAIL` to an address on your verified domain:
- Suggested: `noreply@easy.fr`
- → This goes into: `RESEND_FROM_EMAIL` (backend env on Railway)

---

## 9. Google Gemini — AI / OCR

**URL:** https://aistudio.google.com  
**Goal:** Get a Gemini API key for OCR and chatbot functionality

### 9.1 Get the API key

1. Go to https://aistudio.google.com
2. Sign in with your Google account
3. Click **"Get API key"** in the left sidebar
4. Click **"Create API key"**
5. Select an existing Google Cloud project or create a new one
6. Copy the key — starts with `AIza...`
   - → This goes into: `GOOGLE_API_KEY` (backend env on Railway)

### 9.2 Enable billing (for production usage)

1. Go to https://console.cloud.google.com
2. Select the same project
3. In the left sidebar, click **"Billing"**
4. Link a billing account to avoid hitting free-tier quota limits in production

---

## 10. Final ENV Checklist

### Backend (Railway environment variables)

Paste this in Railway → your backend service → Variables → RAW Editor, filling in each value:

```env
# ── Server ─────────────────────────────────────────────
BASE_URL=https://api.easy.fr
FRONTEND_URL=https://easy.fr
CORS_ORIGINS=https://easy.fr,https://www.easy.fr
IS_PRODUCTION=true

# ── Database ────────────────────────────────────────────
DATABASE_URL=postgresql+asyncpg://postgres:PASSWORD@HOST:5432/railway

# ── Redis ───────────────────────────────────────────────
REDIS_URL=redis://default:PASSWORD@HOST:6379

# ── Clerk ───────────────────────────────────────────────
CLERK_SECRET_KEY=sk_live_...
CLERK_JWKS_URL=https://XXXX.clerk.accounts.dev/.well-known/jwks.json
CLERK_WEBHOOK_SECRET=whsec_...
ADMIN_USER_IDS=user_...

# ── Stripe ──────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_BILLING_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_CONNECT_CLIENT_ID=ca_...
STRIPE_PLATFORM_FEE_PERCENT=0.03

# ── Cloudflare R2 ───────────────────────────────────────
R2_BUCKET_NAME=easyq
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_ENDPOINT_URL=https://ACCOUNT_ID.r2.cloudflarestorage.com
R2_PUBLIC_URL=https://cdn.easy.fr

# ── Resend ──────────────────────────────────────────────
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=noreply@easy.fr

# ── Google Gemini ───────────────────────────────────────
GOOGLE_API_KEY=AIza...

# ── KDS ─────────────────────────────────────────────────
KDS_SECRET_TOKEN=<generate a long random hex, e.g. openssl rand -hex 32>

```

### Frontend (Vercel environment variables)

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
VITE_API_URL=https://api.easy.fr
VITE_WS_URL=wss://api.easy.fr
```

---

## 11. Webhook URLs Summary

| Service | Event(s) | URL to register |
|---------|----------|-----------------|
| Stripe | `payment_intent.succeeded`, `payment_intent.payment_failed` | `https://api.easy.fr/api/v1/payments/webhook` |
| Stripe | `customer.subscription.created/updated/deleted` | `https://api.easy.fr/api/v1/subscriptions/webhook` |
| Clerk | `user.created`, `user.updated`, `user.deleted` | `https://api.easy.fr/api/v1/auth/webhook` |

---

## Recommended Setup Order

1. **OVHCloud** — do DNS last (you need the targets from Railway/Vercel first)
2. **Railway** — deploy backend, create DB + Redis, get connection strings
3. **Vercel** — deploy frontend, get the domain target
4. **OVHCloud** — now add all DNS records with the correct targets
5. **Clerk** — create app, get keys, add webhook (backend must be live for webhook to work)
6. **Stripe** — get keys, create product, add webhooks
7. **Cloudflare R2** — create bucket, get credentials
8. **Resend** — verify domain, get API key
9. **Google Gemini** — get API key
10. **Set all env vars** on Railway and Vercel → Redeploy both
11. **Test** — sign up, upload a menu, make a test payment

---

## Generate KDS Token

Run this once to generate a secure `KDS_SECRET_TOKEN`:

```bash
openssl rand -hex 32
```

Copy the output and paste it into `KDS_SECRET_TOKEN` on Railway.

---

## Verify Everything is Working

```bash
# Check backend is live
curl https://api.easy.fr/health

# Check CORS headers
curl -I -H "Origin: https://easy.fr" https://api.easy.fr/health

# Check frontend
curl -I https://easy.fr
```
