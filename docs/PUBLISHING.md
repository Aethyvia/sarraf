# Publishing Sarraf on Google Play

The steps to a public release, in order. **Owner** = done by the owner in a console; **Claude** = done in this repo. Decisions behind each step are in `DECISIONS.md`.

Fixed facts: package `com.aethyvia.sarraf` (permanent) · personal developer account for now (may move to an organisation later) · public contact help@aethyvia.com · Sarraf Plus is USD-priced only.

## 1. Supabase (Owner)

Run each file once in Supabase → SQL editor, in number order: `supabase/migrations/0001` … `0007`.

| File | What it does | Status |
| --- | --- | --- |
| 0001–0003 | Accounts, subscriptions, supporters | Done |
| 0004 | Daily market rates (needs pg_cron + http extensions) | Done |
| 0005 | Making supporter codes in bulk | Done |
| 0006 | Supporter code use-by dates and revoking | To run |
| 0007 | Daily cleanup of dead supporter codes | To run |

Supporter codes: see `docs/patreon.md`.

## 2. Play Console: payments and the subscription (Owner)

1. **Payments profile:** Settings → Payments profile → create (personal, Pakistan) → add the bank account Google pays out to.
2. **First build:** Play only allows subscriptions once a build with billing is uploaded. Claude makes the signed app bundle (AAB) once Play Billing is in (step 5); upload it at Testing → Internal testing → Create release.
3. **Subscription:** Monetize → Products → Subscriptions → Create subscription.
   - Product ID `sarraf_plus` (permanent). Name "Sarraf Plus".
   - Base plan `monthly`: auto-renewing, every 1 month, **USD 2.99**. Let Play convert prices for other countries.
   - Base plan `yearly`: auto-renewing, every 1 year, **USD 26.99** (3 months free).
   - Grace period **7 days** (matches the app). Activate both plans.
4. **License testers** (test purchases are free): Settings → License testing → add the test phone's Gmail → `RESPOND_NORMALLY`.
5. **Internal testers:** Testing → Internal testing → Testers → email list with the same Gmail → open the opt-in link on that account and accept.

## 3. Service account, so Supabase can check purchases (Owner)

1. Google Cloud Console → the project linked to Play Console → APIs & Services → Library → enable **Google Play Android Developer API**.
2. IAM & Admin → Service accounts → Create, name `sarraf-play-verify`. No Cloud roles.
3. That account → Keys → Add key → JSON. **Never paste this file into chat or the repo.**
4. Play Console → Users and permissions → Invite new users → the service account's email → App permissions: Sarraf → **View financial data** and **Manage orders and subscriptions**.
5. Supabase → Project Settings → Edge Functions → Secrets → add `PLAY_SERVICE_ACCOUNT_JSON` with the whole file as the value. Then delete the downloaded file.

## 4. Public site for the policy links (Owner)

Built from `src/legal/legal.json` by `node scripts/export-site.mjs` (run it after any legal text change). Full steps in `site/README.md`:

1. Public GitHub repo `sarraf-legal` → upload everything in `site/` except `README.md`.
2. Settings → Pages → Deploy from branch `main`, root.
3. DNS: CNAME `sarraf` → `<github-name>.github.io`; Pages → Custom domain `sarraf.aethyvia.com` → Enforce HTTPS.
4. Google Search Console → verify the domain `aethyvia.com` (TXT record).
5. Links for Play Console and the Google sign-in consent screen: `https://sarraf.aethyvia.com/privacy.html`, `https://sarraf.aethyvia.com/terms.html`.

## 5. In the app (Claude, after steps 2–3)

- [ ] Play Billing: buy monthly/yearly, then the server confirms the purchase with Google and records it in `subscriptions`.
- [ ] Supabase edge function `verify-purchase` (uses `PLAY_SERVICE_ACCOUNT_JSON`), and handling of renewals, cancellations and refunds.
- [ ] Remove "Restore purchase" from the Plans page (Play hands back purchases on its own; the app re-checks the plan on every open). Already hidden for lifetime Plus.
- [ ] Tests for the billing flow against Play's test cards.

## 6. Store listing (Claude drafts, Owner submits)

- [ ] Phone screenshots from the emulator (sample data, neutral names), feature graphic 1024 × 500, app icon 512 × 512 (`assets/store-icon-512.png`).
- [ ] Short description (80 characters) and full description.
- [ ] Promo video: Play takes a YouTube link. Use the Play cut without the "Coming soon" pill (`Sarraf-intro-v4-play`, kept locally, not in git).
- [ ] Data safety answers. Money data never leaves the phone and is encrypted there. Optional sign-in: email and account id, sent to Supabase. Backup goes to the user's own Drive, encrypted on the phone first. No ads, no analytics, no data sold or shared. Purchases go through Google Play.
- [ ] Content rating questionnaire (finance tool, no user-to-user content).
- [ ] Target audience: 18+.

## 7. Release (Claude builds, Owner rolls out)

1. `npx eas-cli@latest build --profile production --platform android` → signed AAB (version code increments itself).
2. Internal testing → test purchases with the license tester, a restore on a second phone, and backup.
3. Closed testing with the Supporters track (`docs/patreon.md`), then Production.
