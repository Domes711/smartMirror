# MMM-Spending

Shows today's personal spending on the mirror, sourced from
**Wallet by BudgetBakers** via its REST API. Polls every 5 minutes,
displays total amount + transaction count + the most recent items.

Hidden by default behind `classes: "Domes"` (visibility managed by
`MMM-Profile` / `pages.js`) — only shown to a recognized user.

## What it does

1. Fetches today's records:
   `GET /wallet/v1/api/records?recordDate=gte.<localMidnightUTC>&limit=200`
2. Filters to: `recordType == "expense"`, account in
   `includeAccountIds`, category envelope **not** in `excludeEnvelopeIds`
   (default `[20001]` = Převod / inter-account transfer).
3. Sums `|amount.value|` and ships the totals to the frontend.

Investments (`envelopeId 9002` — Fin. investments) are intentionally
**counted** as spending.

## Getting the API token

1. Open <https://web.budgetbakers.com> and sign in (Wallet Premium /
   lifetime account required for API access).
2. *Settings → API Tokens → Create token*. Name it e.g. `magicmirror-pi`.
3. Copy the token **once** — UI does not show it again.

Tokens are JWTs that expire after ~1 year. The token contains your
e-mail in plaintext (it's signed, not encrypted), so don't share it.

## Deploying on the Pi

```bash
ssh admin@10.0.0.249
mkdir -p ~/.secrets && chmod 700 ~/.secrets
# paste the token, save, then:
chmod 600 ~/.secrets/budgetbakers_token
```

Then in `~/MagicMirror/config/config.js`, replace the
`BB_TOKEN_PLACEHOLDER` value with:

```js
apiToken: require("fs").readFileSync(
  require("os").homedir() + "/.secrets/budgetbakers_token", "utf8"
).trim(),
```

so the live token never lands in this repo.

## Finding your `accountId`s

```bash
TOKEN="$(cat ~/.secrets/budgetbakers_token)"
curl -sS -H "Authorization: Bearer $TOKEN" \
  https://rest.budgetbakers.com/wallet/v1/api/accounts | jq '.accounts[] | {id, name}'
```

Copy the `id` of each account that should count toward "today's
spending" into `includeAccountIds`. Leave it empty (`[]`) to count
all accounts.

## Configure

```js
{
    id: "spending_domes",
    module: "MMM-Spending",
    header: "Útrata dnes",
    config: {
        apiToken: "BB_TOKEN_PLACEHOLDER",   // real token only on Pi
        apiBase: "https://rest.budgetbakers.com/wallet/v1/api",
        includeAccountIds: [
            "ae939246-f1d5-4f14-bce1-c04357e0e77d",  // Běžný účet
            "c989cb70-8e88-4fd5-a103-b3f45278dc41"   // Hotovost
        ],
        excludeEnvelopeIds: [20001],         // Převod
        currency: "CZK",
        timezone: "Europe/Prague",
        recentCount: 3,
        refreshSec: 300,                     // floor 60s
        language: "cs"                       // "cs" | "en"
    }
}
```

Layout (`pages.js`) — bind under each Domes window where it should
appear:

```js
{ id: "spending_domes", position: "top_right" }
```

## Visual preview

Open `demo.html` in a browser to see all rendering states. URL hashes
swap scenarios:

- `#real` — verified real data from 2026-04-27
- `#empty` — 0 transactions
- `#heavy` — 7 transactions, includes investment
- `#big` — five-digit total
- `#loading` — initial state
- `#error` — token expired / API down

`demo-render.js` (Playwright) saves one PNG per scenario.

## Notes

- **No npm deps** — uses native `fetch` (Node 18+), same as MMM-HA-Reminders.
- **Read-only** against Wallet — never writes, never deletes.
- **Failure modes:** on 401 / network error the module shows the last
  good total + a small `⚠` line and keeps retrying.
- **Daily rollover:** a frontend 60s tick triggers a refetch when the
  local-midnight day key changes, so the total resets at midnight
  Europe/Prague even if the polling interval hasn't elapsed.
- **Mixed currencies:** if records span multiple currencies, the total
  shown is the sum within the most-common currency that day.
