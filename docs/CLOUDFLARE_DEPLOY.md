# Always-on Free Deployment

The production setup has two free pieces:

- Cloudflare Workers serves the Vite app continuously, stores data in D1 and
  handles Telegram/Gemini.
- GitHub Actions runs the heavy deterministic CRT scan every five minutes.

This split is intentional. Cloudflare Workers Free has a 10 ms CPU allowance per
request, which is suitable for serving and storing snapshots but not for parsing
all 12 markets and running the complete CRT engine. The browser and GitHub job
still use the same `scanContexts` implementation.

## First deployment

```bash
npm ci
npm test
npm run build
npx wrangler login
npx wrangler d1 create tradebot-state
npm run cloud:migrate
npm run cloud:deploy
```

If `wrangler d1 create` prints a `database_id`, add it to the D1 entry in
`wrangler.jsonc` before migration/deployment.

Add secrets without placing their values in Git:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put SCAN_TOKEN
```

`GEMINI_MODEL` is optional. The default is `gemini-2.0-flash`.

Health endpoints:

```bash
curl https://kodcenter.<account-subdomain>.workers.dev/api/health
curl https://kodcenter.<account-subdomain>.workers.dev/api/live-scan
```

Run a full scan manually:

```bash
CLOUD_SCAN_URL=https://kodcenter.<account-subdomain>.workers.dev \
SCAN_TOKEN=your_scan_token \
npm run cloud:scan
```

## Automatic deployment from GitHub

Create these GitHub Actions repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `CLOUD_SCAN_URL`
- `SCAN_TOKEN`

The API token needs Workers Scripts edit and D1 edit permissions. Pushes to `main`
then run tests, build the app, deploy the Worker and apply D1 migrations.

`CLOUD_SCAN_URL` is the deployed Worker URL. `SCAN_TOKEN` must have exactly the
same value in GitHub Actions and the Cloudflare Worker. Telegram and Gemini
secrets remain only in Cloudflare.

The scheduled workflow runs every five minutes. GitHub can delay scheduled jobs
during platform load. On public repositories standard GitHub-hosted runners are
free; private repositories consume the account's Actions minutes. GitHub also
disables scheduled workflows in public repositories after 60 days without
repository activity, so re-enable the workflow if the repository has been idle.

## Local Cloudflare test

```bash
npm run cloud:migrate:local
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false \
  npx wrangler dev --port 8790 --var SCAN_TOKEN:local-test

CLOUD_SCAN_URL=http://127.0.0.1:8790 \
SCAN_TOKEN=local-test \
npm run cloud:scan
```

Disabling `.env` loading in this test prevents real Telegram messages.

## Security

Rotate any Telegram, Gemini or GitHub tokens that were previously pasted into a
chat or committed anywhere. Store replacements only with `wrangler secret put`.
