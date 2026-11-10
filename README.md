# Freshpet – Next.js port

Port of the PHP app in `download-…/public_html` to Next.js (App Router, TypeScript).

## How it works
- The PHP site was "one file per page, routed by `index.php`", and its front end (GlowingStone JS, `router.min.js`) talks to the server through JSON (`X-SPA` header, `redirect`/`action`/`message` replies).
- `src/app/[[...slug]]/route.ts` plays the role of `index.php`; `src/lib/server.ts` builds the request context (session, user, settings, permissions) and renders the same HTML shell (`src/lib/shell.ts`).
- Each PHP page = one module in `src/modules/<name>.ts` (`/admin/x` → `src/modules/admin/x.ts`), registered in `src/modules/index.ts`. The front-end JS/CSS in `public/` is unchanged, so the UI looks and behaves the same.
- `src/lib/db.ts` mirrors `GStone\DB`, so original SQL is ported as-is (non-strict SQL mode, like the old MariaDB). Sessions live in a `web_sessions` table (auto-created).
- Admin list/form pages share `src/lib/adminList.ts` / `adminForm.ts`; server-side data tables use `src/lib/ajaxTable.ts` (parameterised).
- Uploads live in `storage/` and are served via rewrites in `next.config.mjs`.
- PDFs (offer/joining/relieving letters, COA, GRN invoice, daily report) use `puppeteer-core` + a local Chrome: set `CHROME_PATH`.

## Database: MongoDB
All data lives in MongoDB (database `freshpet`: one collection per table of freshpet.sql, `_id` = the row id, `_schema` = column definitions, `_counters` = AUTO_INCREMENT).
The original SQL statements are kept; `src/lib/msql/` is a small SQL engine (parser, MySQL-compatible expression rules, joins, grouping, ordering, INSERT/UPDATE/DELETE, ON DUPLICATE KEY) that executes them against the collections.
- Standalone mongod has no multi-document transactions: `db.transaction` records an undo step per write and reverts them if the callback throws.
- Verified against the original MySQL: all 57 tables read back identical, ~960 real page queries compared, ~19k generated predicates compared, and the six write suites in scripts/ give the same results and end state on both engines.
- Known differences: rows that tie on every ORDER BY key may come out in a different order than MySQL gave; ordering comparisons (<, >) on free text use a simpler collation; invalid dates such as 2024-04-31 no longer raise an error.

## Run locally
```
npm install
cp .env.example .env.local      # set MONGO_URL / MONGO_DB, SECRET_KEY, ...
npm run build && npm start
```
The MongoDB database must already contain the Freshpet data (collections named after the original tables, plus `_schema` and `_counters`).

## Deploy on Vercel
1. Import this repository in Vercel (framework: Next.js, detected automatically; `vercel.json` raises the function time limit).
2. Add the environment variables from `.env.example` in Project Settings -> Environment Variables. At minimum: `MONGO_URL`, `MONGO_DB`, `SECRET_KEY`, `SITE_URL` (your Vercel domain), `PRODUCTION=1`, `SHOW_OTP=0`, plus the integration keys you use.
3. In MongoDB Atlas -> Network Access, allow Vercel to connect (0.0.0.0/0, or Vercel's static IPs on a paid plan).

Vercel limits: the filesystem is read-only/ephemeral, so uploaded files (`storage/`) and PDF generation with a local Chrome (`CHROME_PATH`) need external storage / a hosted Chromium to work there.

In dev (`PRODUCTION=0`) OTP codes, push, mail and WhatsApp are logged to the server console instead of sent.
Secrets (Firebase JSON, WhatsApp/MSG91 keys, DB password) are NOT copied from `vault/`; supply them via env vars.
Schedule `GET /api/cron/hourly?key=$CRON_KEY` at minute 15 of every hour (replaces `vault/cron-hourly.php`).

## Status
All user-facing pages are ported: ~65 staff modules + 36 admin modules + the `inc/*` endpoints (~110 route modules).
`tsc` is clean and `next build` succeeds. Verified with scripts in `scripts/` against the imported data, on the **production build** (`next start`):
- `smoke-staff-writes.sh`, `smoke-staff-flows.sh`: every staff create form + approvals, status updates, timelines, revoke, mark-paid
- `smoke-production-flow.sh`: lot -> instance -> approval -> accept -> resin -> mould change -> start -> shift log -> verify -> stop -> close (+ role guard on lot close)
- `smoke-dispatch-flow.sh`: dispatch checkpoints, items, signature, COA PDF generation and download
- `smoke-hiring-flow.sh`: candidate -> approvals -> offer/joining/relieving letter PDFs -> email (logged) -> account -> layoff
- `smoke-admin-writes.sh`: products + parameters, clients + transport costs, staff/roles/permissions, admin accounts/profiles, settings + logo upload, dispatch + timeline, GRN/SRN with photo, production log, status/delete
Uploads are served from `storage/` through `/api/files` and require a logged-in session (the PHP served them publicly).

## Deliberately not ported
- `lab.php`, `import-production.php`: one-off data-migration scripts with no login check (they modify data when opened).
- The 07:00 "abnormalities" digest in `cron-hourly.php` (posts to your external AI service) and `maintenance.php` (static page).

## Known gaps / things to verify on your side (need real credentials/hardware)
- Passkey (WebAuthn) login is ported against the stored credentials but could only be tested with the OTP fallback here.
- The AI invoice scanner (needs your AI server), FCM push (Firebase service account), WhatsApp OTP / MSG91 / SMTP delivery: code paths run and log in dev, but real delivery needs your keys. Set `PRODUCTION=1` plus the env vars to enable them.
- `inc/register-approve` was referenced but missing from the export; it is reconstructed (see file comment).

## Notes / deviations from the PHP
- Register entries store the uploaded image filename (matches existing data) – the PHP stored an array by mistake.
- Admin permission save for a single admin updates `WHERE user = ?` (the PHP used the admin id as the permission id).
- Resin form posts on `name` (the PHP checked a non-existent `weight` field, so saving never worked); dispatch create inserts into `dispatches` (the PHP inserted into `users`).
- `shift_parameters` has columns such as `m/c_distributor`; the DB wrapper now backtick-quotes identifiers (the PHP's unquoted SQL could not insert them). Closing a production lot now requires role 15/17 or approve access (the PHP only hid the button).
- The SPA router (`router.min.js`) hoists page-script imports with `/(import .*
)/g`; `fixModuleScripts()` (src/lib/functions.ts) puts each `import ... ;` on its own line for every page, so new modules can write imports and code on one line.
- Pages escape output by default (`h` template helper), unlike the original raw `echo`.
