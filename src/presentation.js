// src/presentation.js
//
// Presentation layer for the store. FastSpring owns commerce + product content
// (names, prices, artwork, descriptions) — the bot pulls all of that live via
// the API, so updating a product in the FastSpring dashboard is reflected in
// Discord with no code change. This file owns only store-level branding and
// WHICH products appear where.
//
// Every path below must match a published FastSpring product path exactly.
const STORE_BRANDING = {
    name: 'Eggblast Arena',
    title: '🛒 Item Shop',
    tagline: 'Stock up on coins and passes to dominate the arena. Pick an item below — your private checkout opens in seconds.',
    color: 0x0099ff, // accent bar down the left of the container
};

// Featured products, shown to everyone. Array order = display order.
//   100-coins   → "Starter Pack"  $0.99  (one-time)
//   battle-pass → "Battle Pass"  $24.99  (recurring, weekly)
const FEATURED_PRODUCTS = ['100-coins', 'battle-pass'];

// VIP-exclusive products — shown in /store ONLY to VIPs (see src/vip.js).
//   500-coins → "Ultimate Pack"  $3.99  (one-time)
//   mega-pack → "MEGA PACK"      $0.01  (one-time)
const VIP_PRODUCTS = ['500-coins', 'mega-pack'];

// The subscription a non-VIP is nudged to buy to unlock VIP perks.
// VIP-by-subscription (src/vip.js) matches ANY active subscription on the
// linked FastSpring account, and battle-pass is the recurring product in the
// featured list — so it doubles as the VIP unlock. Swap this for one of the
// other subscription products (essentials-monthly, professional-monthly,
// advanced-monthly, or their -yearly variants) if you'd rather gate on those.
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
