/**
 * Presentation layer for the store.
 *
 * Division of responsibility:
 *   - FastSpring owns COMMERCE + PRODUCT CONTENT: which products are sellable,
 *     names, prices, artwork (`image`), and descriptions. The bot pulls all of
 *     that live via the API, so updating a product's art/copy in the FastSpring
 *     dashboard is reflected in Discord with no code change.
 *   - This file owns STORE-LEVEL BRANDING (the Eggblast Arena header/logo) and
 *     small cosmetic touches FastSpring doesn't model, like a per-item emoji.
 *
 * Branding images are shipped with the bot and sent as Discord attachments
 * (see store.js), which is more reliable than hosting them behind a tunnel.
 */

const STORE_BRANDING = {
  name: 'Eggblast Arena',
  title: '🏪 In-Game Store',
  tagline:
    'Stock up on gems and passes to dominate the arena. Pick an item below — your private checkout opens in seconds.',
  color: 0x8a2be2, // Eggblast purple
  footer: 'Secure checkout powered by FastSpring',
  // Local asset files in /assets, attached to the message at runtime.
  logoFile: 'eggblast-logo.png',
  heroFile: 'eggblast-hero.png',
};

// Curated, ordered list of FastSpring product paths to feature in this store.
// A hand-picked set rather than the whole catalog (GET /products) — the array
// order is the display order.
// Everything else (name, price, artwork, description) is still pulled live from
// FastSpring per product.
const FEATURED_PRODUCTS = [
  '100-coins',
  'battle-pass',
  'venomtail-egg',
  'lavablast-egg',
];

// VIP-exclusive products — shown in /store ONLY to VIP players (see src/vip.js).
// Editable: swap these paths for whichever items you want gated to VIPs.
const VIP_PRODUCTS = [
  '500-coins',
  'mega-pack',
];

// The subscription product a non-VIP is nudged to buy to unlock VIP perks.
const VIP_UPSELL_PRODUCT = 'battle-pass';

// Shown only when a product has no description set in FastSpring.
const FALLBACK_BLURB = 'Select to view details and purchase.';

module.exports = {
  STORE_BRANDING,
  FEATURED_PRODUCTS,
  VIP_PRODUCTS,
  VIP_UPSELL_PRODUCT,
  FALLBACK_BLURB,
};
