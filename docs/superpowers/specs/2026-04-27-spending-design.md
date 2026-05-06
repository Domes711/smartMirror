# MMM-Spending — Design Spec

**Date:** 2026-04-27
**Status:** Approved

## Goal

Show today's spending on the mirror, sourced from the user's
**Wallet by BudgetBakers** account via its REST API. The user already
records every transaction in Wallet (manually or via bank import), so
this module just reads, filters and sums.

## Why this source

Czech retail banks don't expose a hobby-grade transaction API; PSD2 is
possible but token rotation is painful. The user has a lifetime Wallet
plan and already enters every transaction there, so Wallet is the
canonical record of personal spending — single source, no double entry.

## Architecture

```
Wallet REST API ──HTTPS──► node_helper.js ──socket──► MMM-Spending.js ──DOM──► mirror
                            (poll 5 min)               (render)
```

Standard MM module shape, mirroring `MMM-HA-Reminders`:

- **`node_helper.js`** — polls
  `GET https://rest.budgetbakers.com/wallet/v1/api/records?recordDate=gte.<startOfTodayUTC>&limit=200`
  with `Authorization: Bearer <token>` every `refreshSec` (default 300).
  Filters records, sums expenses, emits `MMSP_DATA` socket notification.
- **`MMM-Spending.js`** — receives data, renders three lines:
  total amount → transaction count → last 2–3 items (payee + amount).
- **`MMM-Spending.css`** — large total, smaller secondary lines, muted
  recent items.

## REST API contract (verified 2026-04-27)

**Endpoint:** `https://rest.budgetbakers.com/wallet/v1/api/records`
**Auth:** `Authorization: Bearer <JWT>` (token issued at
`web.budgetbakers.com/settings/apiTokens`, ~1 year expiry).

**Query params we use:**

| Param | Value | Note |
|---|---|---|
| `recordDate` | `gte.<ISO8601 UTC>` | PostgREST-style operator. `from=` does NOT work. |
| `limit` | up to ~200 | Default 30, default window 90 days. |

**Response shape (relevant fields):**

```json
{
  "limit": 50,
  "offset": 0,
  "recordDateRange": ["gte.2026-04-27T00:00:00Z", "lt.2026-07-27T00:00:00Z"],
  "records": [
    {
      "id": "...",
      "accountId": "ae939246-f1d5-4f14-bce1-c04357e0e77d",
      "payee": "ONTHATASS",
      "amount": { "value": -259.99, "currencyCode": "CZK" },
      "baseAmount": { "value": -259.99, "currencyCode": "CZK" },
      "recordDate": "2026-04-27T05:13:05Z",
      "category": {
        "id": "...",
        "name": "Clothes & shoes",
        "envelopeId": 2000
      },
      "recordState": "uncleared",
      "recordType": "expense",
      "paymentType": "transfer"
    }
  ]
}
```

Records ordered ascending by `recordDate` within the requested window.
`amount.value` is negative for `recordType=expense`, positive for income.

## Filtering rules

A record counts toward today's spending iff **all** of:

1. `recordType == "expense"` (skip income)
2. `accountId` is in `includeAccountIds` (default: Běžný + Hotovost only —
   excludes Živnostenský / business and Spořicí / savings to keep it
   personal)
3. `category.envelopeId != 20001` (skip "Převod" / inter-account transfers)
4. `recordDate >= startOfTodayLocal`, evaluated in `Europe/Prague`
   (server-side filter is UTC midnight; client-side trims again so a
   record at 00:30 local time isn't dropped just because UTC is still
   yesterday)

**Investments (`envelopeId 9002`) DO count** — explicit user choice;
investing into a brokerage is treated as outgoing personal spending.

Sum is `Σ |amount.value|` of matching records, in `amount.currencyCode`.
We assume single currency (CZK); if mixed currencies appear we just sum
by currency and display the dominant one (rare in practice).

## UI

```
┌──────────────────────────────┐
│   432,99 Kč                  │  ← .mmsp-total (large, white)
│   2 transakce dnes           │  ← .mmsp-count (medium, muted)
│                              │
│   ONTHATASS         260 Kč   │  ← .mmsp-recent (small, muted)
│   TOP TABAK         173 Kč   │
└──────────────────────────────┘
```

- Header: "Útrata dnes" (configurable).
- Total uses `Intl.NumberFormat("cs-CZ", { style: "currency", currency })`.
- Count line uses Czech grammar: `1 transakce / 2-4 transakce / 5+ transakcí`.
- Recent list shows last `recentCount` entries (default 3), newest first,
  payee truncated to ~24 chars.
- Empty state: "— žádné výdaje".
- Error state: error text + last successful timestamp ("naposledy
  aktualizováno HH:MM").

Rolls over at local midnight: a `setInterval(60_000)` checks if
`startOfTodayLocal` changed and triggers a refetch.

## Configuration

```js
{
  module: "MMM-Spending",
  position: "top_right",
  header: "Útrata dnes",
  config: {
    apiToken: "BB_TOKEN_PLACEHOLDER",          // real token only on Pi
    apiBase: "https://rest.budgetbakers.com/wallet/v1/api",
    includeAccountIds: [
      "ae939246-f1d5-4f14-bce1-c04357e0e77d",  // Běžný účet
      "c989cb70-8e88-4fd5-a103-b3f45278dc41"   // Hotovost
    ],
    excludeEnvelopeIds: [20001],               // Převod
    currency: "CZK",
    timezone: "Europe/Prague",
    recentCount: 3,
    refreshSec: 300,
    language: "cs"                             // "cs" | "en"
  }
}
```

The token is **scrubbed** in this repo (placeholder); the real token
lives only in `~/MagicMirror/config/config.js` on the Pi.

## Visibility / profile integration

The mirror's MMM-Profile decides who sees what. Spending is personal,
so the module is hidden by default and shown only for the recognized
user. In `config.js` the entry carries `id: "spending_domes"` and the
visibility binding is added in `pages.js` under the `Domes` profile
(same pattern as `reminders_domes`).

## Failure modes

| Situation | Behavior |
|---|---|
| Token expired / 401 | Show error "API token expired", keep retrying |
| Network down | Show last good total + error banner |
| Wallet API 5xx | Show last good total + error banner |
| No records today | Show `0 Kč` + "— žádné výdaje" |
| Mixed currencies | Sum per currency, show dominant; log warning |

## Out of scope

- Writing back to Wallet (read-only).
- Multi-day views ("this week / month") — possible follow-up.
- Pulling bank statements directly (PSD2 / GoCardless).
- Caching to disk — RAM-only is fine, refresh recovers after restart.

## Dependencies

- Node 18+ (`fetch` built-in) — already used by MMM-HA-Reminders.
- No npm packages.

## References

- Wallet REST API docs (in-app): `web.budgetbakers.com` →
  Settings → API Tokens.
- Marketing page:
  https://budgetbakers.com/en/products/wallet/integrations/rest-api/
- Help center:
  https://support.budgetbakers.com/hc/en-us/articles/10761479741586-Rest-API
