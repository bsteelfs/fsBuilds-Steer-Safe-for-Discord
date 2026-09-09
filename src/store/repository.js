// src/store/repository.js
//
// PlayerLink repository — maps a Discord user to their FastSpring account,
// and tracks which webhook events have already been processed.
//
// Storage: a single JSON file (data/links.json). Deliberately simple for a
// DevRel reference build — easy to inspect, zero dependencies. The module is a
// thin abstraction so you can swap the JSON file for a real database
// (SQLite/Postgres) without touching any caller: keep the same four functions.
//
// Single-process only. A multi-instance deployment must move this to a shared
// database, or two bot instances will race on the same file.
//
// PRIVACY: this file stores customer email (PII). It lives in /data, which is
// gitignored, and must never be committed.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// BOT_DATA_DIR lets the test suite point storage at a throwaway directory so
// tests never touch (or depend on) your real data/links.json.
const DATA_DIR = process.env.BOT_DATA_DIR || path.join(__dirname, '../../data');
const FILE = path.join(DATA_DIR, 'links.json');

// Cap the processed-event log so the file can't grow without bound. FastSpring
// retries happen within minutes, so a rolling window is plenty.
const MAX_PROCESSED_EVENTS = 1000;

// How long a checkout session token stays valid. Long enough that a player can
// mull over a purchase, short enough that a leaked link goes stale.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function load() {
    try {
        const db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        // Defensive: tolerate a file written by an older shape.
        return {
            links: Array.isArray(db.links) ? db.links : [],
            processedEvents: Array.isArray(db.processedEvents) ? db.processedEvents : [],
            checkoutSessions: Array.isArray(db.checkoutSessions) ? db.checkoutSessions : [],
        };
    } catch {
        // Missing file, or invalid JSON — start empty rather than crash.
        return { links: [], processedEvents: [], checkoutSessions: [] };
    }
}

function save(db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

function getByDiscordId(discordUserId) {
    return load().links.find((l) => l.discordUserId === discordUserId) || null;
}

/**
 * Insert or update a link, keyed on discordUserId. Idempotent: re-running
 * with the same data just refreshes updatedAt (this is what makes it safe to
 * call from the webhook on a retried/duplicate order.completed event).
 */
function upsert({ discordUserId, fsAccountId, email }) {
    const db = load();
    const now = new Date().toISOString();
    const existing = db.links.find((l) => l.discordUserId === discordUserId);

    if (existing) {
        existing.fsAccountId = fsAccountId ?? existing.fsAccountId;
        existing.email = email ?? existing.email;
        existing.updatedAt = now;
        save(db);
        return existing;
    }

    const record = {
        discordUserId,
        fsAccountId: fsAccountId ?? null,
        email: email ?? null,
        linkedAt: now,
        updatedAt: now,
    };
    db.links.push(record);
    save(db);
    return record;
}

/**
 * WEBHOOK IDEMPOTENCY.
 *
 * FastSpring delivers each event at least once — network retries and non-2xx
 * responses cause redelivery, so the SAME order.completed can arrive several
 * times. Anything with a side effect (granting items, sending a DM, crediting
 * an account) must run only once per event id.
 *
 * Usage in the webhook handler:
 *   if (hasProcessedEvent(event.id)) return;   // already handled — skip
 *   ...do the work...
 *   markEventProcessed(event.id);
 *
 * NOTE: this check-then-mark is not atomic. It's fine for a single-process bot;
 * in production, use a database with a unique constraint on the event id so two
 * concurrent deliveries can't both pass the check.
 */
function hasProcessedEvent(eventId) {
    if (!eventId) return false;
    return load().processedEvents.includes(eventId);
}

function markEventProcessed(eventId) {
    if (!eventId) return;
    const db = load();
    if (db.processedEvents.includes(eventId)) return;

    db.processedEvents.push(eventId);
    // Keep only the most recent N ids.
    if (db.processedEvents.length > MAX_PROCESSED_EVENTS) {
        db.processedEvents = db.processedEvents.slice(-MAX_PROCESSED_EVENTS);
    }
    save(db);
}

/**
 * CHECKOUT SESSIONS (how the buyer's Discord identity reaches the order).
 *
 * The web shop reads a `session_token` query param and attaches it to the order
 * as a FastSpring order tag. So instead of putting the raw Discord id in the
 * URL — where the buyer could edit it to credit someone else — the bot mints an
 * unguessable token per checkout, remembers who it belongs to HERE, and puts
 * only the token in the link. The webhook then trades the token back for the
 * Discord identity.
 *
 * Tokens expire (SESSION_TTL_MS) and are pruned on write, so this can't grow
 * without bound. They are intentionally NOT consumed on use: a buyer may
 * complete more than one order from the same /store message.
 */
function createCheckoutSession({ discordUserId, discordUsername }) {
    const token = crypto.randomBytes(24).toString('base64url');
    const db = load();
    const now = Date.now();

    db.checkoutSessions = db.checkoutSessions.filter((s) => now - s.createdAtMs < SESSION_TTL_MS);
    db.checkoutSessions.push({
        token,
        discordUserId,
        discordUsername: discordUsername ?? null,
        createdAtMs: now,
        createdAt: new Date(now).toISOString(),
    });
    save(db);

    return token;
}

/** Returns { discordUserId, discordUsername } for a token, or null if unknown/expired. */
function getCheckoutSession(token) {
    if (!token) return null;

    const session = load().checkoutSessions.find((s) => s.token === token);
    if (!session) return null;
    if (Date.now() - session.createdAtMs >= SESSION_TTL_MS) return null;

    return session;
}

module.exports = {
    getByDiscordId,
    upsert,
    hasProcessedEvent,
    markEventProcessed,
    createCheckoutSession,
    getCheckoutSession,
};
