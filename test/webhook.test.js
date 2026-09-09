const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolate storage and pin a known secret BEFORE loading the app.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fsbuilds-webhook-test-'));
process.env.BOT_DATA_DIR = TMP_DIR;
process.env.FS_WEBHOOK_SECRET = 'test-secret-do-not-use-in-production';
process.env.WEBSHOP_URL = 'https://eggblaststore.example.dev/';
process.env.DISCORD_GUILD_ID = '000000000000000000';

const startServer = require('../src/web/server');
const repository = require('../src/store/repository');

let server;
let baseUrl;

before(async () => {
    // Port 0 = let the OS pick a free port, so the suite never collides with a
    // bot instance that's already running on PORT.
    process.env.PORT = '0';
    server = startServer();
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://localhost:${server.address().port}`;
});

after(() => {
    server?.close();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

beforeEach(() => fs.rmSync(path.join(TMP_DIR, 'links.json'), { force: true }));

function sign(body, secret = process.env.FS_WEBHOOK_SECRET) {
    return crypto.createHmac('sha256', secret).update(Buffer.from(body)).digest('base64');
}

function orderPayload({ eventId = 'evt_test', tags = {} } = {}) {
    return JSON.stringify({
        events: [{
            id: eventId,
            type: 'order.completed',
            data: {
                id: 'ORDER-1',
                account: 'acct_test',
                customer: { email: 'buyer@example.com' },
                tags,
            },
        }],
    });
}

function post(body, signature) {
    const headers = { 'Content-Type': 'application/json' };
    if (signature !== undefined) headers['X-FS-Signature'] = signature;
    return fetch(`${baseUrl}/webhook`, { method: 'POST', headers, body });
}

// The handler acks first and finishes the work in the background, so give it a
// moment before asserting on side effects.
const settle = () => new Promise((r) => setTimeout(r, 150));

describe('signature verification', () => {
    test('rejects a request with no signature header', async () => {
        const res = await post(orderPayload(), undefined);
        assert.strictEqual(res.status, 401);
    });

    test('rejects a signature computed with the wrong secret', async () => {
        const body = orderPayload();
        const res = await post(body, sign(body, 'wrong-secret'));
        assert.strictEqual(res.status, 401);
    });

    test('rejects a tampered body whose signature no longer matches', async () => {
        const signature = sign(orderPayload());
        const res = await post(orderPayload({ tags: { session_token: 'injected' } }), signature);
        assert.strictEqual(res.status, 401);
    });

    test('accepts a correctly signed request', async () => {
        const body = orderPayload();
        const res = await post(body, sign(body));
        assert.strictEqual(res.status, 200);
    });

    test('rejects malformed JSON even when correctly signed', async () => {
        const body = 'this is not json';
        const res = await post(body, sign(body));
        assert.strictEqual(res.status, 400);
    });
});

describe('identity resolution via session_token', () => {
    test('resolves the buyer and persists the FastSpring account link', async () => {
        const token = repository.createCheckoutSession({ discordUserId: 'u42', discordUsername: 'bsteel' });
        const body = orderPayload({ tags: { session_token: token } });

        await post(body, sign(body));
        await settle();

        const link = repository.getByDiscordId('u42');
        assert.strictEqual(link.fsAccountId, 'acct_test');
        assert.strictEqual(link.email, 'buyer@example.com');
    });

    test('still honours a storefront that tags the Discord id directly', async () => {
        const body = orderPayload({ tags: { discord_uid: 'u99', discord_uname: 'legacy' } });

        await post(body, sign(body));
        await settle();

        assert.strictEqual(repository.getByDiscordId('u99').fsAccountId, 'acct_test');
    });

    test('an untagged order links nobody, but still returns 200', async () => {
        const body = orderPayload({ tags: {} });

        const res = await post(body, sign(body));
        await settle();

        assert.strictEqual(res.status, 200);
        assert.strictEqual(repository.getByDiscordId('u42'), null);
    });
});

describe('idempotency', () => {
    test('a redelivered event is processed only once', async () => {
        const token = repository.createCheckoutSession({ discordUserId: 'u42' });
        const body = orderPayload({ eventId: 'evt_dupe', tags: { session_token: token } });

        await post(body, sign(body));
        await settle();
        const afterFirst = repository.getByDiscordId('u42').updatedAt;

        await post(body, sign(body));
        await settle();
        const afterSecond = repository.getByDiscordId('u42').updatedAt;

        assert.strictEqual(afterFirst, afterSecond, 'the duplicate delivery must not re-run the write');
    });
});

describe('health check', () => {
    test('GET /ping responds', async () => {
        const res = await fetch(`${baseUrl}/ping`);
        assert.strictEqual(res.status, 200);
    });
});
