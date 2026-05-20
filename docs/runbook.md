# Runbook

## Cloudflare Access

App: `Mood` (Zero Trust → Access → Applications)
- Domain: `mood.clydeford.net`
- Application ID: `7008030b-601c-4a15-9b38-d373e3c2b4db`
- Policy: `Owner` — allow email `stevie.johnston@gmail.com`
- Identity providers: account default (One-Time PIN)
- AUD Tag: stored in `wrangler.toml` under `ACCESS_AUD`
- Team domain: `clydeford.cloudflareaccess.com` (in `wrangler.toml` under `ACCESS_TEAM_DOMAIN`)

If you want to harden with an explicit MFA `require` rule, edit the `Owner` policy in the Zero Trust dashboard and add an Authentication Method require — the existing IdP-level MFA gates login regardless.

## Resources

- D1: `mood` (id `2f3ca975-a2e0-4e54-a614-43a4d981c6ae`, pinned in `wrangler.toml`)
- KV: `mood-tracker-MOOD_KV` (id `fba452e26c3841348a5b195951dc645d`, binding `KV`)
- Worker: `mood-tracker`

## Deploy

1. Source `.env` to expose `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
2. `npm run migrate:remote` if there are new migrations.
3. `npm run deploy`.

## Local dev

1. `npm run migrate:local`
2. `npm run dev`
3. The dev server bypasses Access; it falls back to `DEV_FAKE_EMAIL` from `.dev.vars`.
