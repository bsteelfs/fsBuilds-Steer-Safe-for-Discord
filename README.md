# fsBuilds — Discord In-Game Store Bot (FastSpring)

A reference Discord bot that sells in-game items through FastSpring. Players
browse a branded store inside Discord, buy on your FastSpring-powered web shop,
and get a confirmation DM the moment FastSpring says the order completed —
with VIP-only items gated by Discord role or active subscription.

> **Building it yourself?** The full walkthrough — architecture, every design
> decision, and the code behind each piece — is in
> [`docs/build-guide.md`](docs/build-guide.md).

## What it does

| Feature | How |
|---|---|
| **`/store`** | Ephemeral Components V2 message: featured products with live FastSpring artwork, prices and buy buttons. VIPs see an extra ⭐ Exclusives section; everyone else gets a subscribe-to-unlock upsell. |
| **`/announce`** | Community-manager-only public announcement, optionally featuring up to three products. |
| **VIP gating** | A player is VIP if they hold the Discord VIP role **or** their linked FastSpring account has an active subscription. |
| **Purchase confirmation** | FastSpring `order.completed` webhook → HMAC-verified → buyer identified → identity link saved → confirmation DM. Idempotent, so retried deliveries never double-fire. |

FastSpring owns the catalog: names, prices, artwork and descriptions are pulled
live from the API. Change a product in the dashboard and Discord follows.

## Quick start

**Prerequisites:** Node 18+, a FastSpring account with a web storefront and API
credentials, a Discord account that can add a bot to a server, and a tunnel
(e.g. ngrok) so FastSpring can reach your webhook during development.

```bash
npm install
cp .env.example .env    # then fill in every value — each one says where to find it
npm start
```

In Discord, run `/store`.

Every variable in `.env` is documented inline in [`.env.example`](.env.example).
The three that trip people up:

- `WEBSHOP_URL` must include `https://` — the bot parses it with `new URL()`.
- `DISCORD_VIP_ROLE_ID` / `DISCORD_CM_ROLE_ID` are optional; blank turns that feature off.
- `FS_WEBHOOK_SECRET` must be byte-for-byte identical to the HMAC secret in FastSpring → Integrations → Webhooks.

## How a purchase flows

```
Player runs /store ──► bot fetches products from FastSpring API
                   ──► bot mints a session token, saves token→Discord user
                   ──► buy button links: WEBSHOP_URL?prod=…&session_token=…

Player buys on the web shop ──► shop tags the order with session_token

FastSpring fires order.completed ──► POST /webhook (HMAC-signed)
                                 ──► verify signature · ack 200 · skip if seen
                                 ──► session_token → Discord user
                                 ──► save Discord ↔ FastSpring account link
                                 ──► DM the buyer
```

The Discord id never appears in the checkout URL — only an unguessable,
expiring token that means nothing off this server.

## Project structure

```
src/
  index.js              boots the webhook server, then the bot
  bot.js                Discord client, command registration + dispatch
  commands/
    store.js            /store — Components V2 catalog with VIP section
    announce.js         /announce — CM-gated public post
  ui.js                 shared Components V2 helpers (product cards, budget)
  presentation.js       branding + WHICH products appear where  ← edit me
  vip.js                VIP decision (role OR active subscription)
  roles.js              Discord role check
  fastspring/
    api.js              FastSpring REST client (Basic Auth, one place)
    catalog.js          GET /products/{path}
    accounts.js         GET /accounts?subscriptions=active (paginated)
    session.js          builds web-shop links; mints session tokens
  store/
    repository.js       JSON-file store: identity links, processed events, sessions
  web/
    server.js           Express app (raw body on /webhook for HMAC)
    routes/webhook.js   FastSpring webhook handler
test/                   node:test suite — run with `npm test`
```

## Testing

```bash
npm test
```

Zero test dependencies (Node's built-in `node:test`). The suite covers HMAC
verification incl. tampered bodies, duplicate-delivery suppression, session
token minting/expiry, the Components V2 payloads (including that VIP products
never leak to non-VIPs and the 40-component cap holds), and role checks. The
webhook tests run against the real Express app on an OS-assigned port and use a
temp directory for storage, so they never touch `data/` or a running bot.

## Before production

See [Production hardening](docs/build-guide.md#production-hardening) in the
build guide. The short list: move `data/links.json` to a real database, add a
unique constraint on webhook event ids, register commands globally, and grant
items from your game server inside the webhook handler.

## License

ISC
