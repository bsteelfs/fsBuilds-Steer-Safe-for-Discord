const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Point storage at a throwaway directory BEFORE requiring the module under
// test, so nothing here touches the real data/links.json.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fsbuilds-repo-test-'));
process.env.BOT_DATA_DIR = TMP_DIR;

const repository = require('../src/store/repository');

function resetStore() {
    fs.rmSync(path.join(TMP_DIR, 'links.json'), { force: true });
}

after(() => fs.rmSync(TMP_DIR, { recursive: true, force: true }));

describe('identity links', () => {
    beforeEach(resetStore);

    test('returns null for an unknown Discord user', () => {
        assert.strictEqual(repository.getByDiscordId('nobody'), null);
    });

    test('upsert creates a link that can be read back', () => {
        repository.upsert({ discordUserId: 'u1', fsAccountId: 'acct1', email: 'a@b.com' });

        const link = repository.getByDiscordId('u1');
        assert.strictEqual(link.discordUserId, 'u1');
        assert.strictEqual(link.fsAccountId, 'acct1');
        assert.strictEqual(link.email, 'a@b.com');
    });

    test('upsert is idempotent — a repeat delivery does not duplicate the record', () => {
        repository.upsert({ discordUserId: 'u1', fsAccountId: 'acct1', email: 'a@b.com' });
        repository.upsert({ discordUserId: 'u1', fsAccountId: 'acct1', email: 'a@b.com' });

        const db = JSON.parse(fs.readFileSync(path.join(TMP_DIR, 'links.json'), 'utf8'));
        assert.strictEqual(db.links.length, 1);
    });

    test('upsert updates an existing link without losing linkedAt', () => {
        const first = repository.upsert({ discordUserId: 'u1', fsAccountId: 'acct1' });
        const second = repository.upsert({ discordUserId: 'u1', fsAccountId: 'acct2', email: 'new@b.com' });

        assert.strictEqual(second.fsAccountId, 'acct2');
        assert.strictEqual(second.email, 'new@b.com');
        assert.strictEqual(second.linkedAt, first.linkedAt);
    });

    test('a missing/corrupt store file degrades to empty rather than throwing', () => {
        fs.writeFileSync(path.join(TMP_DIR, 'links.json'), 'not json at all');
        assert.strictEqual(repository.getByDiscordId('u1'), null);
    });
});

describe('webhook idempotency', () => {
    beforeEach(resetStore);

    test('an unseen event is not yet processed', () => {
        assert.strictEqual(repository.hasProcessedEvent('evt1'), false);
    });

    test('marking an event makes it processed', () => {
        repository.markEventProcessed('evt1');
        assert.strictEqual(repository.hasProcessedEvent('evt1'), true);
    });

    test('marking the same event twice stores it once', () => {
        repository.markEventProcessed('evt1');
        repository.markEventProcessed('evt1');

        const db = JSON.parse(fs.readFileSync(path.join(TMP_DIR, 'links.json'), 'utf8'));
        assert.strictEqual(db.processedEvents.filter((id) => id === 'evt1').length, 1);
    });

    test('a missing event id is never considered processed', () => {
        assert.strictEqual(repository.hasProcessedEvent(undefined), false);
    });
});

describe('checkout sessions', () => {
    beforeEach(resetStore);

    test('a minted token resolves back to the Discord user', () => {
        const token = repository.createCheckoutSession({ discordUserId: 'u1', discordUsername: 'bsteel' });

        const session = repository.getCheckoutSession(token);
        assert.strictEqual(session.discordUserId, 'u1');
        assert.strictEqual(session.discordUsername, 'bsteel');
    });

    test('tokens are unguessable and unique per checkout', () => {
        const a = repository.createCheckoutSession({ discordUserId: 'u1' });
        const b = repository.createCheckoutSession({ discordUserId: 'u1' });

        assert.notStrictEqual(a, b);
        assert.ok(a.length >= 32, 'token should be long enough to resist guessing');
    });

    test('an unknown token resolves to null', () => {
        assert.strictEqual(repository.getCheckoutSession('made-up-token'), null);
        assert.strictEqual(repository.getCheckoutSession(undefined), null);
    });

    test('an expired token no longer resolves', () => {
        const token = repository.createCheckoutSession({ discordUserId: 'u1' });

        // Age the stored session past the 24h TTL.
        const file = path.join(TMP_DIR, 'links.json');
        const db = JSON.parse(fs.readFileSync(file, 'utf8'));
        db.checkoutSessions[0].createdAtMs -= 25 * 60 * 60 * 1000;
        fs.writeFileSync(file, JSON.stringify(db));

        assert.strictEqual(repository.getCheckoutSession(token), null);
    });
});
