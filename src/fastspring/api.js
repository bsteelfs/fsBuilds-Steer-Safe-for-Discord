/**
 * Minimal FastSpring REST API client — the one place credentials are read and
 * requests are made, so every other FastSpring module stays focused on its
 * domain (products, accounts) rather than on HTTP plumbing.
 *
 * Auth: FastSpring uses HTTP Basic Auth with an API username + password pair.
 *   WHERE: FastSpring Dashboard → Integrations → API Credentials
 *          (https://app.fastspring.com/settings/api) → "Create Credentials".
 *   The password is shown once, at creation — store it in .env immediately.
 *
 * Uses Node's built-in fetch (Node 18+), so there's no HTTP dependency.
 */
const API_BASE = 'https://api.fastspring.com';

function authHeader() {
    const user = process.env.FASTSPRING_API_USER;
    const pass = process.env.FASTSPRING_API_PASSWORD;

    if (!user || !pass) {
        throw new Error('Missing FASTSPRING_API_USER / FASTSPRING_API_PASSWORD in .env');
    }

    // Basic Auth is "Basic " + base64("username:password").
    return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

/**
 * GET a FastSpring API path and return the parsed JSON body.
 *
 * @param {string} path  e.g. '/products/500-coins' or '/accounts?subscriptions=active'
 * @throws on a non-2xx response, with the status in the message so the caller
 *         can log something more useful than "fetch failed".
 */
async function get(path) {
    const response = await fetch(`${API_BASE}${path}`, {
        method: 'GET',
        headers: { Authorization: authHeader(), Accept: 'application/json' },
    });

    if (!response.ok) {
        throw new Error(`FastSpring API ${path} → ${response.status} ${response.statusText}`);
    }

    return response.json();
}

module.exports = { get };
