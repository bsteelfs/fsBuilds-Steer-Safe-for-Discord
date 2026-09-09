const express = require('express');
const crypto = require('crypto');
const { client } = require('../../bot');
const {
    upsert,
    hasProcessedEvent,
    markEventProcessed,
    getCheckoutSession,
} = require('../../store/repository');

const router = express.Router();

/**
 * POST /webhook
 *
 * Receives FastSpring order events. Configure this URL in:
 *   FastSpring Dashboard → Integrations → Webhooks
 *   (the FULL url — including https:// and the /webhook path)
 *
 * Events subscribed: order.completed (minimum)
 * HMAC secret: FS_WEBHOOK_SECRET must match the dashboard value exactly.
 */
router.post('/', (req, res) => {
    const secret = process.env.FS_WEBHOOK_SECRET;
    if (!secret) {
        // Fail loudly rather than letting createHmac throw an opaque 500.
        console.error('[Webhook] FS_WEBHOOK_SECRET is not set — cannot verify signatures.');
        return res.status(500).send('Webhook secret not configured');
    }

    const signatureHeader = req.headers['x-fs-signature'];
    if (!signatureHeader) {
        return res.status(401).send('Missing signature');
    }

    // Verify the HMAC signature before touching the payload. FastSpring signs
    // the RAW request body with HMAC-SHA256 and sends it Base64-encoded.
    // (This route is mounted with express.raw() in server.js, so req.body is
    // still a Buffer here — parsing it before verifying would break the check.)
    const hash = crypto.createHmac('sha256', secret).update(req.body).digest('base64');
    const signatureBuffer = Buffer.from(signatureHeader);
    const hashBuffer = Buffer.from(hash);

    if (signatureBuffer.length !== hashBuffer.length || !crypto.timingSafeEqual(signatureBuffer, hashBuffer)) {
        console.warn('[Webhook] Signature verification failed — possible spoofed request.');
        return res.status(401).send('Invalid signature');
    }

    let payload;
    try {
        payload = JSON.parse(req.body.toString('utf8'));
    } catch (err) {
        return res.status(400).send('Invalid JSON format');
    }

    // Acknowledge IMMEDIATELY, then process in the background.
    // FastSpring retries on a non-2xx or slow response, so doing Discord API
    // work (which can take seconds, or hang) before replying is exactly what
    // causes duplicate deliveries — and therefore duplicate DMs.
    res.status(200).send('Webhook received');

    const events = Array.isArray(payload.events) ? payload.events : [];
    for (const event of events) {
        processEvent(event).catch((err) =>
            console.error(`[Webhook] Error processing event ${event?.id}:`, err.message)
        );
    }
});

async function processEvent(event) {
    console.log(`[Webhook] Event received | type: ${event.type} | id: ${event.id}`);

    // IDEMPOTENCY: FastSpring delivers each event AT LEAST once — retries mean
    // the same order.completed can arrive several times. Skip anything already
    // handled so retries don't re-grant items or re-send confirmation DMs.
    if (hasProcessedEvent(event.id)) {
        console.log(`[Webhook] Event ${event.id} already processed — skipping.`);
        return;
    }

    if (event.type === 'order.completed') {
        await handleOrderCompleted(event);
    }

    markEventProcessed(event.id);
}

async function handleOrderCompleted(event) {
    // FastSpring delivers the order as event.data, with fields at the TOP
    // level. NOTE: data.order is the order id as a STRING (a duplicate of
    // data.id), NOT a nested object — read everything off `data` itself.
    const orderData = event.data || event;
    const orderId = orderData.id || orderData.order || event.id;
    const tags = orderData.tags || {};

    console.log('[Webhook] Parsed FastSpring tags:', tags);

    // PRIMARY PATH: the web shop tags the order with the `session_token` we put
    // in the buy-button link. Trade it back for the Discord user who clicked.
    const session = getCheckoutSession(tags.session_token);
    if (tags.session_token && !session) {
        console.warn(`[Webhook] session_token ${tags.session_token} is unknown or expired — cannot identify the buyer.`);
    }

    // FALLBACK: if a storefront is ever configured to tag the Discord id
    // directly, honour that too. Tag KEY NAMES are storefront config, not fixed
    // by FastSpring, so accept both common conventions.
    const discordUserId =
        session?.discordUserId ||
        tags.discord_uid || tags.discordUserId ||
        orderData.attributes?.discord_uid || orderData.custom?.discord_uid;
    const discordUsername =
        session?.discordUsername ||
        tags.discord_uname || tags.discordUsername ||
        orderData.attributes?.discord_uname || orderData.custom?.discord_uname;

    if (!discordUserId) {
        console.log('⚠️ Order completed, but no Discord user id was found in the payload.');
        console.log('Full event data for debugging:', JSON.stringify(orderData, null, 2));
        return;
    }

    // ─── PASSIVE IDENTITY LINK ────────────────────────────────────────────
    // A completed order proves the buyer controls BOTH identities: the Discord
    // id we tagged onto checkout, and the FastSpring account that paid. Persist
    // the mapping so VIP-by-subscription (src/vip.js) can check it later.
    try {
        upsert({
            discordUserId,
            fsAccountId: orderData.account,
            email: orderData.customer?.email,
        });
        console.log(`🔗 Linked Discord ${discordUserId} ↔ FastSpring account ${orderData.account}`);
    } catch (err) {
        console.warn('[Webhook] Failed to persist identity link:', err.message);
    }

    // ─── GRANT ITEMS ──────────────────────────────────────────────────────
    // TODO: call your game server's API here to grant the purchased items, e.g.
    //   for (const item of orderData.items || []) {
    //     await gameServerApi.grantItem(discordUserId, item.product, item.quantity);
    //   }
    // ──────────────────────────────────────────────────────────────────────

    if (!client.isReady()) {
        console.warn('[Webhook] Discord client not ready — skipping confirmation DM.');
        return;
    }

    // Confirm the purchase by DM. We resolve the buyer THROUGH THE GUILD rather
    // than client.users.fetch() so Discord can establish the mutual-guild link
    // required to open a DM (a plain user fetch commonly fails with "cannot
    // send messages to this user"). Fetching one member by id uses the REST API
    // and does NOT require the privileged GuildMembers intent.
    try {
        const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
        const member = await guild.members.fetch(discordUserId);
        await member.send(
            `🎉 **Thank you for your purchase, ${discordUsername || 'Player'}!**\n` +
            `Your order (\`${orderId}\`) has been processed and your items have been granted.`
        );
        console.log(`✅ Confirmation DM sent to ${discordUsername || discordUserId}`);
    } catch (dmError) {
        // Non-fatal: the buyer may have DMs from server members disabled, or
        // may have left the server.
        console.warn(`⚠️ Could not DM user ${discordUserId}:`, dmError.message);
    }
}

module.exports = router;
