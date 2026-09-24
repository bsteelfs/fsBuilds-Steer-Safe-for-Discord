v,nzvb,vcb# Eggblast Arena — Discord Web Shop Bot

A Discord bot that brings your **FastSpring** web shop into your game's Discord
server. Players run `/store` to see featured products (pulled live from
FastSpring) and jump to a pre-filled checkout; community managers run `/announce`
to promote season updates and products to the whole server; and VIP members see
exclusive items no one else does.

This guide walks you through building and running it yourself, with pointers to
the exact code that powers each piece.

---

## What it does

- **`/store`** — a single, branded message with featured product cards (image,
  description, price) and a buy button on each, plus a **VIP Exclusives** section
  for members and an **Unlock VIP** upsell for everyone else.
- **`/announce`** — community-manager-only. Posts a public web-shop announcement
  with an optional custom banner and product cards chosen live from the catalog.
- **VIP logic** — a player is VIP by a Discord role *or* an active FastSpring
  subscription.
- **Purchase confirmation + identity linking** — a FastSpring webhook confirms
  purchases and quietly maps the Discord user to their FastSpring account.

Everything runs from **one bot**. Product data (names, prices, art, descriptions)
lives in FastSpring and is fetched live, so updating the shop needs no code change.

---

## How it works

```
Player (Discord)
   │  /store
   ▼
Discord bot (discord.js)                     ┌──────────────────────────────┐
   │  GET /products/{path} per item     ───► │        FastSpring API        │
   │  ◄── name, price, image, desc            │  (products, accounts)        │
   │                                          └──────────────────────────────┘
   │  builds a buy button per product
   ▼
One Components-V2 message (buy + browse buttons)
   │  click → opens the hosted FastSpring web shop, pre-filled (?prod=&uid=&uname=)
   ▼
Hosted web shop → buyer checks out            │ order.completed (HMAC signed)
   ▼                                          ▼
Your server  POST /webhook  ◄──────────────────
   │  1. verify HMAC SHA256 signature
   │  2. link Discord id ↔ FastSpring account (passive)
   │  3. (TODO) grant the item in-game
   │  4. DM the buyer to confirm
```

**Client (Discord) → your backend (Node/Express) → FastSpring.** The bot never
handles payment — FastSpring does. The bot surfaces products, hands off to the
web shop, and listens for the result.

---

## Prerequisites

- Node.js 18+
- A **FastSpring** account with products, a web shop, and API access
- A **Discord** application + bot
- A public HTTPS URL that forwards to your local server (so FastSpring can reach
  the `/webhook` endpoint during development)

---

## Project structure

```
src/
├── index.js                 entry point — starts the web server, then the bot
├── discord-client.js        the shared discord.js client
├── bot.js                   registers commands, routes interactions
├── presentation.js          branding, featured list, VIP list (edit this to reshape the shop)
├── roles.js                 hasRole() helper
├── vip.js                   checkVip() — role OR active subscription
├── commands/
│   ├── store.js             /store message (cards, buy buttons, VIP section)
│   └── announce.js          /announce (CM-only, product autocomplete, custom banner)
├── fastspring/
│   ├── api.js               FastSpring API client (Basic auth)
│   ├── catalog.js           fetch products from FastSpring
│   ├── session.js           build web-shop deep links
│   └── accounts.js          subscription lookup (VIP)
├── store/
│   └── repository.js        Discord ↔ FastSpring link store (JSON file)
└── web/
    ├── server.js            Express server (captures raw body for HMAC)
    └── routes/webhook.js    POST /webhook → verify → link → confirm
assets/                      branding images (hero banner + logo)
data/                        link store (gitignored — contains email PII)
```

---

## Setup

### 1. Install

```bash
npm install
cp .env.example .env
```

### 2. Create the Discord bot

1. In the Discord Developer Portal, create an application.
2. Under **Bot**, copy the token → `DISCORD_BOT_TOKEN`. Copy the **Application ID**
   → `DISCORD_CLIENT_ID`.
3. Invite the bot with **both** the `bot` and `applications.commands` scopes. The
   `bot` scope is required — without it the bot can run commands but can't DM:
   ```
   https://discord.com/api/oauth2/authorize?client_id=<CLIENT_ID>&permissions=2147567616&scope=bot%20applications.commands
   ```
4. Enable Developer Mode in Discord, right-click your server → **Copy Server ID**
   → `DISCORD_GUILD_ID`. (Registering to one server makes commands appear
   instantly, which is ideal for development.)

### 3. Connect FastSpring

1. **API credentials**: FastSpring dashboard → Settings → API Credentials →
   `FS_API_USERNAME` / `FS_API_PASSWORD`. These authenticate the product and
   subscription lookups:
   ```js
   // src/fastspring/api.js
   const fsApi = axios.create({
     baseURL: 'https://api.fastspring.com',
     auth: { username: process.env.FS_API_USERNAME, password: process.env.FS_API_PASSWORD },
     headers: { 'Content-Type': 'application/json' },
   });
   ```
2. **Web shop URL**: set `WEBSHOP_URL` to your hosted web shop. Buy buttons deep
   link to it with the product and buyer identity pre-filled.
3. **Webhook**: FastSpring dashboard → Integrations → Webhooks → add a URL
   endpoint:
   - URL: `https://<your-public-url>/webhook` (include `https://` and the
     `/webhook` path)
   - HMAC SHA256 Secret → `FS_WEBHOOK_SECRET`
   - Subscribe to **`order.completed`**

### 4. Expose your server

Start a public HTTPS tunnel to your local port (`PORT`, default 3000), put that
URL in `.env` as `SERVER_URL`, and use it as the webhook endpoint in step 3. A
reserved/stable domain is worth it so the webhook URL doesn't change on restart.

### 5. Set up roles

Create three roles in your server: **VIP**, **Community Manager**, **Player**.
Copy the VIP and Community Manager role IDs (Developer Mode → right-click role →
Copy Role ID) into `.env`:

```
DISCORD_VIP_ROLE_ID=<vip role id>
DISCORD_CM_ROLE_ID=<community manager role id>
```

- **VIP** → sees exclusive items in `/store`.
- **Community Manager** → allowed to run `/announce`.
- **Player** → the default; standard experience.

**Hide `/announce` from non-managers:** the command is registered so it's hidden
from members without Manage Server by default. To show it to your Community
Manager role specifically, go to **Server Settings → Integrations → (your bot) →
Command Permissions → `/announce`** and allow the Community Manager role. The bot
also re-checks the role at runtime:

```js
// src/commands/announce.js
function isCommunityManager(interaction) {
  const cmRoleId = process.env.DISCORD_CM_ROLE_ID;
  return cmRoleId
    ? hasRole(interaction, cmRoleId)
    : interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}
```

### 6. Choose what the shop shows

Edit `src/presentation.js` — no other code changes needed:

```js
// Featured products (everyone). Array order = display order.
const FEATURED_PRODUCTS = ['plasma-overdrive-egg', 'infinite-battle-pass', 'battle-pass'];

// VIP-only products.
const VIP_PRODUCTS = ['time-warp-egg', 'titan-forge-egg', 'unstable-nucleus-egg'];

// The subscription a non-VIP is nudged to buy to unlock VIP perks.
const VIP_UPSELL_PRODUCT = 'infinite-battle-pass';
```

Branding (title, tagline, color, and the `assets/` hero + logo images) also lives
in `presentation.js` under `STORE_BRANDING`.

### 7. Run

```bash
npm start
```

Run `/store` in your server.

---

## Environment variables

| Variable | Description |
|---|---|
| `DISCORD_BOT_TOKEN` | Bot token from the Developer Portal |
| `DISCORD_CLIENT_ID` | Application (client) ID |
| `DISCORD_GUILD_ID` | Server ID to register commands to |
| `FS_API_USERNAME` / `FS_API_PASSWORD` | FastSpring API credentials |
| `FS_WEBHOOK_SECRET` | HMAC secret matching the FastSpring webhook config |
| `WEBSHOP_URL` | Hosted web shop the buy/browse buttons link to |
| `SERVER_URL` | Public URL forwarding to your server (for the `/webhook` endpoint) |
| `PORT` | Local server port (default 3000) |
| `DISCORD_VIP_ROLE_ID` | Role that grants VIP (in addition to active subscriptions) |
| `DISCORD_CM_ROLE_ID` | Role allowed to run `/announce` |

> **Security:** never commit `.env`. All secrets belong in `.env` only;
> `.env.example` documents the keys.

---

## Commands

### `/store`
Ephemeral (only the player sees it). Shows the branded header + browse button, the
VIP section (or upsell), and the featured items — each product with its own buy
button that deep links to the web shop, pre-filled with the product and the
player's Discord identity:

```js
// src/fastspring/session.js — per-player buy link
function buildCheckoutUrl(productPath, discordUserId, discordUsername) {
  const base = process.env.WEBSHOP_URL || DEFAULT_WEBSHOP_URL;
  const params = new URLSearchParams({ uname: discordUsername, uid: discordUserId, prod: productPath });
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${params.toString()}`;
}
```

### `/announce`
Community-manager-only. Posts a **public** web-shop message.

| Option | Purpose |
|---|---|
| `message` | Announcement text |
| `title` | Headline |
| `image` | Custom banner (uploaded file); falls back to the default hero |
| `product1`–`product5` | Products to feature — **autocompleted live from FastSpring** |
| `ping` | Ping `@everyone` |

The product options autocomplete straight from your catalog, so a manager curates
each announcement with no code:

```js
// src/commands/announce.js — live product autocomplete
async function autocomplete(interaction) {
  const focused = (interaction.options.getFocused() || '').toLowerCase();
  const paths = await fetchAllProductPaths();          // GET /products
  await interaction.respond(
    paths.filter((p) => p.toLowerCase().includes(focused)).slice(0, 25).map((p) => ({ name: p, value: p }))
  );
}
```

Public announcements use an identity-free product link (no single buyer to tag):

```js
// src/fastspring/session.js
function featureUrl(productPath) {
  const base = process.env.WEBSHOP_URL || DEFAULT_WEBSHOP_URL;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}prod=${encodeURIComponent(productPath)}`;
}
```

---

## How the key pieces work

### Live product data from FastSpring
The bot fetches only the products it needs and normalizes them for display —
FastSpring is the source of truth for name, price, image, and description:

```js
// src/fastspring/catalog.js
async function fetchProducts(paths) {
  const list = (paths || []).slice(0, 25);
  const results = await Promise.all(
    list.map((path) =>
      fsApi.get(`/products/${path}`).then((r) => r.data.products?.[0] || null).catch(() => null)
    )
  );
  return results.filter(Boolean).map(normalizeProduct); // { path, displayName, price, imageUrl, description }
}
```

### The single-message storefront (Components V2)
`/store` renders one cohesive message: a hero banner, a browse button, then a
card + buy button per product, grouped into **VIP Exclusives** and **Featured
Items** sections with dividers.

> **Component limit:** a Components-V2 message can contain at most **40**
> components (every section, text block, thumbnail, button, and divider counts).
> Each product card costs ~5, so the build caps the combined card count. If you
> feature many products, expect to trade some off against dividers/sections.

### VIP validation
A player is VIP by role **or** active subscription:

```js
// src/vip.js
async function checkVip(interaction) {
  const viaRole = hasRole(interaction, process.env.DISCORD_VIP_ROLE_ID);
  let viaSubscription = false;
  const link = playerLinks.getByDiscordId(interaction.user.id);   // Discord → FastSpring account
  if (link?.fsAccountId) {
    viaSubscription = await accounts.hasActiveSubscription(link.fsAccountId); // GET /accounts?subscriptions=active
  }
  return { vip: viaRole || viaSubscription, viaSubscription, viaRole };
}
```

Two things to know about the **subscription** path (also noted in the code):
- It requires the Discord ↔ FastSpring **link**, which is created only when a
  purchase carries the buyer's Discord id (see below). Until the web shop passes
  that id onto orders, the subscription path is dormant and VIP is role-only.
- It matches **any** active subscription. To gate on a specific product, check the
  subscription's product path.

### The webhook: verify, link, confirm
FastSpring signs each webhook with your HMAC secret; the handler verifies it
before trusting anything, then links the account and DMs the buyer:

```js
// src/web/routes/webhook.js — signature check
function verifySignature(rawBody, signature) {
  if (!rawBody || !signature) return false;
  const computed = crypto.createHmac('sha256', process.env.FS_WEBHOOK_SECRET).update(rawBody).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
  } catch {
    return false;
  }
}
```

```js
// passive identity link — a completed purchase proves the buyer controls both ids
const fsAccountId = data?.account;
const email = data?.customer?.email;
if (discordUserId && fsAccountId) {
  playerLinks.upsert({ discordUserId, fsAccountId, email, linkSource: 'purchase' });
}
```

> **Reading the payload:** in `order.completed`, `data.order` is the order id
> string — the real fields (`tags`, `account`, `customer`) sit at the top level of
> `data`. Read `data.tags`, `data.account`, `data.customer.email` directly.

---

## Privacy & data

- `data/links.json` stores customer **email (PII)**. It is **gitignored** and must
  never be committed.
- The link store is a single JSON file (`src/store/repository.js`) behind a small
  interface, so you can swap it for a database without touching callers.

---

## Before production

- **Webhook idempotency** — FastSpring may deliver the same event more than once.
  Dedupe on `event.id` before granting anything (flagged with a `// TODO` in the
  webhook handler; the link upsert is already idempotent).
- **Real fulfillment** — replace the grant-item `// TODO` in the webhook handler
  with a call to your game's grant API. Today it confirms + DMs but doesn't
  deliver goods.
- **Pass the Discord id onto orders** — for subscription-based VIP and buyer
  confirmation on real purchases, the web shop needs to attach the `uid`/`uname`
  it receives as FastSpring order tags.
- **Global command rollout** — commands register to one guild for fast dev
  iteration; switch to application-wide registration for a public rollout.

---

## Troubleshooting

- **DM fails with "no mutual guilds"** — the bot was invited without the `bot`
  scope. Re-invite with both `bot` and `applications.commands`.
- **FastSpring log: "host parameter is null"** — the webhook URL is missing the
  `https://` scheme. Enter the full URL including scheme and `/webhook` path.
- **Webhook fields read as `undefined`** — read `data.tags` / `data.account` /
  `data.customer.email` (top level), not `data.order.*` (that's the order id).
- **`/store` hangs on "thinking"** — usually the Components-V2 40-component limit;
  reduce featured/VIP items or dividers.
- **A featured product doesn't appear** — confirm the path in `presentation.js`
  matches the FastSpring product path exactly and the product is published under
  the configured API credentials.

---

Built as a FastSpring developer sample. The stack (discord.js + Express) is kept
minimal so the FastSpring integration stays front and center.
