# Sarraf public site (GitHub Pages)

The Terms of Use and Privacy Policy that Google Play and Google sign-in link to, plus a small home page.
Built from `src/legal/legal.json` (the same text the app shows) by `node scripts/export-site.mjs`.
After changing the legal text, run that script and copy `site/` again.

## Put it online (once)

1. On GitHub, create a new **public** repository, for example `sarraf-legal`. (Free GitHub only serves Pages from public repos; the app's own code stays private.)
2. Upload everything in this folder except this README: `index.html`, `privacy.html`, `terms.html`, `icon.png`, `favicon.png`.
3. Repository → **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)` → Save.
4. After a minute the site is at `https://<your-github-name>.github.io/sarraf-legal/` with `privacy.html` and `terms.html`.

## Your own domain (needed for Google's sign-in review)

Google wants the privacy page on a domain you own and have verified, for example `sarraf.aethyvia.com`.

1. In your domain's DNS, add a **CNAME** record: name `sarraf`, value `<your-github-name>.github.io`.
2. Repository → Settings → Pages → **Custom domain**: `sarraf.aethyvia.com` → Save, then tick **Enforce HTTPS** once it's offered.
3. Links to use everywhere: `https://sarraf.aethyvia.com/privacy.html` and `https://sarraf.aethyvia.com/terms.html`.
4. Verify `aethyvia.com` in Google Search Console (it gives you a TXT record to add), so Google accepts the domain.
