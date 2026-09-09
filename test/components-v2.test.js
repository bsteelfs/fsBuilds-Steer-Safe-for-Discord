const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.BOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fsbuilds-v2-test-'));
process.env.WEBSHOP_URL = 'https://eggblaststore.example.dev/';

const { buildStoreContainer } = require('../src/commands/store');
const { buildAnnouncementContainer } = require('../src/commands/announce');
const { describeProduct, MAX_COMPONENTS } = require('../src/ui');

// Minimal stand-ins shaped like real FastSpring product responses.
const withImage = (product, name, usd) => ({
    product,
    display: { en: name },
    pricing: { price: { USD: usd } },
    image: `https://cdn.example.com/${product}.png`,
    description: { summary: { en: `${name} blurb` } },
});
const withoutImage = (product, name, usd) => ({
    product,
    display: { en: name },
    pricing: { price: { USD: usd } },
});

const FALLBACK = 'Select to view details and purchase.';
const toItem = (p) => describeProduct(p, FALLBACK);
const checkoutUrlFor = (p) => `https://eggblaststore.example.dev/?prod=${p}&session_token=tok`;

/** Counts every component in the payload — Discord's 40 cap counts them all. */
function countComponents(json) {
    let n = 1;
    for (const child of json.components || []) n += countComponents(child);
    if (json.accessory) n += 1;
    return n;
}

describe('describeProduct', () => {
    test('pulls name, price, blurb and artwork from the FastSpring payload', () => {
        const item = toItem(withImage('500-coins', 'Ultimate Pack', 3.99));

        assert.strictEqual(item.displayName, 'Ultimate Pack');
        assert.strictEqual(item.price, '$3.99');
        assert.strictEqual(item.blurb, 'Ultimate Pack blurb');
        assert.ok(item.imageUrl);
    });

    test('falls back to the product path and a blurb when fields are unset', () => {
        const item = describeProduct({ product: 'mystery-box', pricing: {} }, FALLBACK);

        assert.strictEqual(item.displayName, 'mystery-box');
        assert.strictEqual(item.price, 'See store');
        assert.strictEqual(item.blurb, FALLBACK);
        assert.strictEqual(item.imageUrl, null);
    });
});

describe('/store container', () => {
    const featured = [withImage('100-coins', 'Starter Pack', 0.99), withImage('battle-pass', 'Battle Pass', 24.99)].map(toItem);
    const vipItems = [withImage('500-coins', 'Ultimate Pack', 3.99), withImage('mega-pack', 'MEGA PACK', 0.01)].map(toItem);

    test('serializes to a valid Components V2 payload', () => {
        const json = buildStoreContainer({ featured, vipItems: [], upsell: null, isVip: false, checkoutUrlFor }).toJSON();

        assert.strictEqual(json.type, 17, 'top level should be a Container');
        assert.ok(Array.isArray(json.components) && json.components.length > 0);
    });

    test('a VIP sees the VIP section and no upsell', () => {
        const json = buildStoreContainer({ featured, vipItems, upsell: null, isVip: true, checkoutUrlFor }).toJSON();
        const text = JSON.stringify(json);

        assert.ok(text.includes('VIP Exclusives'));
        assert.ok(!text.includes('Unlock VIP'));
        assert.ok(text.includes('MEGA PACK'), 'VIP-only product should render for a VIP');
    });

    test('a non-VIP sees the upsell and none of the VIP products', () => {
        const upsell = toItem(withImage('battle-pass', 'Battle Pass', 24.99));
        const json = buildStoreContainer({ featured, vipItems: [], upsell, isVip: false, checkoutUrlFor }).toJSON();
        const text = JSON.stringify(json);

        assert.ok(text.includes('Unlock VIP'));
        assert.ok(!text.includes('MEGA PACK'), 'VIP-only products must not leak to non-VIPs');
    });

    test('every product renders a buy button pointing at the shop', () => {
        const json = buildStoreContainer({ featured, vipItems, upsell: null, isVip: true, checkoutUrlFor }).toJSON();
        // Product paths can start with a digit (100-coins, 500-coins).
        const urls = JSON.stringify(json).match(/https:\/\/eggblaststore\.example\.dev\/\?prod=[a-z0-9-]+/g) || [];

        assert.strictEqual(new Set(urls).size, 4, 'one distinct checkout link per product');
    });

    test('stays under Discord\'s 40-component cap even with a full catalog', () => {
        const many = Array.from({ length: 12 }, (_, i) => toItem(withImage(`item-${i}`, `Item ${i}`, i + 1)));
        const json = buildStoreContainer({ featured: many, vipItems: many, upsell: null, isVip: true, checkoutUrlFor }).toJSON();

        assert.ok(countComponents(json) <= MAX_COMPONENTS, `expected <= ${MAX_COMPONENTS}, got ${countComponents(json)}`);
    });

    test('a product with no artwork still renders (button becomes the accessory)', () => {
        const noArt = [toItem(withoutImage('plain-pack', 'Plain Pack', 1.5))];
        const json = buildStoreContainer({ featured: noArt, vipItems: [], upsell: null, isVip: false, checkoutUrlFor }).toJSON();

        assert.ok(JSON.stringify(json).includes('Plain Pack'));
    });
});

describe('/announce container', () => {
    const products = [withImage('mega-pack', 'MEGA PACK', 0.01)].map(toItem);

    test('serializes to a valid Components V2 payload', () => {
        const json = buildAnnouncementContainer({ title: 'Season 4', message: 'Live now!', products, ping: false }).toJSON();

        assert.strictEqual(json.type, 17);
        assert.ok(JSON.stringify(json).includes('Season 4'));
    });

    test('the @everyone ping lives inside the text, since V2 forbids content', () => {
        const json = buildAnnouncementContainer({ title: 'T', message: 'M', products: [], ping: true }).toJSON();

        assert.ok(JSON.stringify(json).includes('@everyone'));
    });

    test('no ping means no @everyone anywhere in the payload', () => {
        const json = buildAnnouncementContainer({ title: 'T', message: 'M', products: [], ping: false }).toJSON();

        assert.ok(!JSON.stringify(json).includes('@everyone'));
    });

    test('featured product links carry no session token (public post, no single buyer)', () => {
        const json = buildAnnouncementContainer({ title: 'T', message: 'M', products, ping: false }).toJSON();

        assert.ok(!JSON.stringify(json).includes('session_token'));
    });
});
