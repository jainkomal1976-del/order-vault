# OrderVault — PRD

## What it is
A mobile-first Expo app that lets a user manually log online shopping orders across Amazon, Flipkart, Myntra, Ajio, Nykaa, Meesho, and other Indian e-commerce platforms — all in one local vault, with fast entry, delivery tracking, return-window reminders, and spend analytics.

## Users
Single-user, on-device. No login. Data lives in AsyncStorage.

## Tech
- Frontend: Expo (SDK 54), expo-router, TypeScript, react-native-gifted-charts, expo-image-picker.
- Backend (only for OCR): FastAPI + `emergentintegrations` → Gemini 2.5 Flash vision via `EMERGENT_LLM_KEY`.
- Storage: local `AsyncStorage` (key `ordervault.orders.v1`). MongoDB kept in stack for future cloud sync.

## Screens
1. **Home** — Search bar, platform + status filter chip rows, 3 summary cards (This month spend, In transit, Return soon), scrollable order list with platform-color accent strip, status badge, and "X days left to return" badge.
2. **Add Order** — Sparkles OCR banner (pick a screenshot → auto-fills product name / price / platform / order date / qty via Gemini), **Paste order text banner** (opens Quick Add), platform circle selector, product image picker, form (name/price/qty/dates/order-id/category/status/payment/notes), sticky Save button.
3. **Quick Add (`/quick-add`)** — Full-screen paste area with "Paste from clipboard" helper. Runs `POST /api/parse/text` (Gemini) on the pasted text, shows a preview card of the extracted fields, then "Continue" hands off to Add Order via `pendingPrefill` in `OrderContext`. Universal — works for Gmail email bodies, WhatsApp forwards, shipping SMS, notification text, etc.
4. **Analytics** — Bar chart (spend by platform, brand-colored) + donut pie (spend by category) + top-line stats (total, this month, orders, top platform).
5. **Settings** — Theme radio (System / Light / Dark), CSV export via native Share, Clear all (double-tap confirm), About.
6. **Order Detail (`/order/[id]`)** — Hero, return-window banner (green > 7d, orange ≤ 7d, red ≤ 3d, gray if closed), quick actions (Mark Delivered / Shipped / Returned), vertical status timeline stepper, editable notes, delete (double-tap confirm).

## Sync Now
Home header has a "Sync Now" pill. It reads the clipboard once — if it contains meaningful text, opens Quick Add pre-filled. If empty, shows a toast asking to copy an order email/SMS first. Zero OAuth, zero credentials.

## Key rules
- Return deadline = `actual_delivery ?? expected_delivery` + platform days (Amazon 10, Flipkart 7, Myntra 14, Ajio 15, Nykaa 15, Meesho 7). Auto-recomputes on status/date change.
- Marking "Delivered" auto-fills `actual_delivery = today` if not set.
- Empty _id / ObjectId cannot leak: backend has no persistent order collection.

## API
- `GET /api/health` → `{status:"ok"}`
- `POST /api/ocr/order` — screenshot → structured order (Gemini vision)
- `POST /api/parse/text` — text → structured order (Gemini)
- `GET /api/gmail/start?return_url=` — 302 redirects to Google OAuth
- `GET /api/gmail/callback` — Google → us. Exchanges code, stashes tokens under a short-lived `session_id`, returns HTML bounce page that redirects browser to `return_url?session=<id>`
- `POST /api/gmail/session/consume` — one-shot exchange of `session_id` for `{access_token, refresh_token, expires_at, email}`
- `POST /api/gmail/refresh` — refresh access token
- `POST /api/gmail/revoke` — revoke at Google
- `POST /api/gmail/sync` — scans Gmail across all 6 e-commerce senders (30 days, 25 msgs), extracts each via Gemini, returns list

## Gmail flow (Phase B)
Frontend uses `expo-web-browser` + `expo-linking`. On "Connect Gmail" tap:
1. `openAuthSessionAsync(startUrl, Linking.createURL('gmail-connected'))`
2. Backend redirects through Google → user consents → Google → `/api/gmail/callback` → HTML bounce back to app returnUrl with `?session=X`
3. App consumes `session_id` → stores `{access_token, refresh_token, expires_at, email}` in `expo-secure-store` (native) / `localStorage` (web)
4. Home "Sync Now" routes to `/gmail-review` which scans inbox and shows the review queue with Add / Skip per parsed email
5. Duplicates detected by `order_id` OR by `[gmail:<message_id>]` tag inserted in notes on save

## Google Cloud requirements (personal use — no cost)
OAuth consent screen in **Testing mode**, scopes: openid, email, profile, `gmail.readonly`. Client ID + Secret in `/app/backend/.env`. Yellow "unverified" warning is normal — just Advanced → Continue.

## Out of scope for MVP
Push notifications, cloud sync, multi-user auth, barcode scan, delivery reminders (visual badges only).

## Files
- Frontend: `/app/frontend/app/(tabs)/{index,add,analytics,settings}.tsx`, `/app/frontend/app/order/[id].tsx`, `/app/frontend/src/context/OrderContext.tsx`, `/app/frontend/src/constants.ts`, `/app/frontend/src/components/*`.
- Backend: `/app/backend/server.py`.
