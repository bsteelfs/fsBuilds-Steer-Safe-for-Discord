const fs = require('fs');
const path = require('path');

/**
 * PlayerLink repository — maps a Discord user to their FastSpring account.
 *
 * Storage: a single JSON file (data/links.json). This is intentionally simple
 * for a DevRel reference build — it's easy to inspect and has zero dependencies.
 * The whole module is a thin abstraction so you can swap the JSON file for a
 * real database (SQLite/Postgres) without touching the callers: keep the same
 * functions (getByDiscordId, upsert).
 *
 * Single-process only — fine for one bot instance. A multi-instance deployment
 * should move this to a shared database.
 *
 * PRIVACY: this file stores customer email (PII). It lives in /data, which is
 * gitignored, and must never be committed.
 *
 * PlayerLink shape:
 *   {
 *     discordUserId: string,   // primary key
 *     fsAccountId:   string,   // FastSpring account id (reverse-lookup key)
 *     email:         string,
 *     gamePlayerId:  string|null,  // reserved for future fulfillment
 *     linkSource:    'purchase' | 'manual',
 *     linkedAt:      ISO string,
 *     updatedAt:     ISO string
 *   }
 */

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'links.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    // Missing or unreadable file → start empty.
    return { links: [] };
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
 * Insert or update a link, keyed on discordUserId. Idempotent: re-running with
 * the same data simply refreshes updatedAt (and preserves the original
 * linkedAt). Returns the stored record.
 */
function upsert({ discordUserId, fsAccountId, email, gamePlayerId, linkSource }) {
  const db = load();
  const now = nowIso();
  const existing = db.links.find((l) => l.discordUserId === discordUserId);

  if (existing) {
    existing.fsAccountId = fsAccountId ?? existing.fsAccountId;
    existing.email = email ?? existing.email;
    if (gamePlayerId !== undefined) existing.gamePlayerId = gamePlayerId;
    existing.linkSource = linkSource ?? existing.linkSource;
    existing.updatedAt = now;
    save(db);
    return existing;
  }

  const record = {
    discordUserId,
    fsAccountId: fsAccountId ?? null,
    email: email ?? null,
    gamePlayerId: gamePlayerId ?? null,
    linkSource: linkSource ?? 'manual',
    linkedAt: now,
    updatedAt: now,
  };
  db.links.push(record);
  save(db);
  return record;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = { getByDiscordId, upsert };
