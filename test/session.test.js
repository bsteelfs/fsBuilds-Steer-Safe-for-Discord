const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fsbuilds-session-test-'));
process.env.BOT_DATA_DIR = TMP_DIR;
process.env.WEBSHOP_URL = 'https://eggblaststore.example.dev/';

const { generateCheckoutUrl, featureUrl, browseUrl } = require('../src/fastspring/session');
const { getCheckoutSession } = require('../src/store/repository');

beforeEach(() => fs.rmSync(path.join(TMP_DIR, 'links.json'), { force: true }));
after(() => fs.rmSync(TMP_DIR, { recursive: true, force: true }));

describe('generateCheckoutUrl', () => {
    test('pre-selects the product', () => {
        const url = new URL(generateCheckoutUrl('500-coins', 'u1', 'bsteel'));
        assert.strictEqual(url.searchParams.get('prod'), '500-coins');
    });

    test('carries a session token that resolves to the buyer', () => {
        const url = new URL(generateCheckoutUrl('500-coins', 'u1', 'bsteel'));
        const token = url.searchParams.get('session_token');

        assert.ok(token, 'a session_token should be present');
        assert.strictEqual(getCheckoutSession(token).discordUserId, 'u1');
    });

    test('never leaks the Discord id or username into the URL', () => {
        const url = generateCheckoutUrl('500-coins', '424242424242', 'bsteel');

        assert.ok(!url.includes('424242424242'), 'Discord id must not appear in the URL');
        assert.ok(!url.includes('bsteel'), 'Discord username must not appear in the URL');
        assert.ok(!url.includes('uid='), 'the shop ignores uid — it should not be sent');
        assert.ok(!url.includes('uname='), 'the shop ignores uname — it should not be sent');
    });

    test('mints a distinct token per checkout', () => {
        const a = new URL(generateCheckoutUrl('500-coins', 'u1', 'bsteel')).searchParams.get('session_token');
        const b = new URL(generateCheckoutUrl('mega-pack', 'u1', 'bsteel')).searchParams.get('session_token');

        assert.notStrictEqual(a, b);
    });
});

describe('featureUrl (public announcements)', () => {
    test('pre-selects the product but carries no identity', () => {
        const url = new URL(featureUrl('mega-pack'));

        assert.strictEqual(url.searchParams.get('prod'), 'mega-pack');
        assert.strictEqual(url.searchParams.get('session_token'), null);
    });
});

describe('browseUrl', () => {
    test('is the bare shop URL with no params', () => {
        assert.strictEqual(new URL(browseUrl()).search, '');
    });
});

describe('WEBSHOP_URL validation', () => {
    test('a URL without a scheme fails with a message that says so', () => {
        const original = process.env.WEBSHOP_URL;
        process.env.WEBSHOP_URL = 'eggblaststore.example.dev/'; // no https://

        assert.throws(() => featureUrl('mega-pack'), /include https:\/\//);
        process.env.WEBSHOP_URL = original;
    });

    test('a missing WEBSHOP_URL is reported clearly', () => {
        const original = process.env.WEBSHOP_URL;
        delete process.env.WEBSHOP_URL;

        assert.throws(() => featureUrl('mega-pack'), /WEBSHOP_URL is not defined/);
        process.env.WEBSHOP_URL = original;
    });
});
