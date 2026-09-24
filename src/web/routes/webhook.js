const { Router } = require('express');
const crypto = require('crypto');
const client = require('../../discord-client');
const playerLinks = require('../../store/repository');

const router = Router();

/**
 * POST /webhook
 *
 * Receives FastSpring order events. Configure this URL in:
 *   FastSpring Dashboard → Integrations → Webhooks
 *
 * Events subscribed: order.completed (minimum)
 * HMAC secret: set FS_WEBHOOK_SECRET in your .env to match the dashboard value.
 */
router.post('/', (req, res) => {
  // Verify the HMAC signature before touching the payload.
  // FastSpring signs the raw request body with HMAC-SHA256 and sends it
  // as the X-FS-Signature header (Base64-encoded).
  const signature = req.headers['x-fs-signature'];

  if (!verifySignature(req.rawBody, signature)) {
    console.warn('[Webhook] Signature verification failed — possible spoofed request.');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Respond 200 immediately. FastSpring retries on non-2xx responses,
  // so we acknowledge first and process asynchronously.
  res.status(200).json({ received: true });

  const events = req.body.events || [];
  for (const event of events) {
    processEvent(event).catch((err) =>
      console.error(`[Webhook] Error processing event ${event.id}:`, err.message)
    );
  }
});

function verifySignature(rawBody, signature) {
  if (!rawBody || !signature) return false;

  const hmac = crypto.createHmac('sha256', process.env.FS_WEBHOOK_SECRET);
  hmac.update(rawBody);
  const computed = hmac.digest('base64');

  try {
    // timingSafeEqual prevents timing-based attacks.
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Dispatch a single FastSpring event.
 *
 * IMPORTANT — Idempotency:
 * FastSpring may deliver the same event more than once (network retries, etc.).
 * Before granting items or crediting accounts, check whether you've already
 * processed this event.id. In production, store processed IDs in a database
 * and skip duplicates. The stub below logs a reminder.
 */
async function processEvent(event) {
  console.log(`[Webhook] Event received | type: ${event.type} | id: ${event.id}`);

  // TODO (production): check your database for event.id before proceeding.
  // if (await db.events.exists(event.id)) return;
  // await db.events.markProcessed(event.id);

  if (event.type === 'order.completed') {
    await handleOrderCompleted(event.data);
  }
}

async function handleOrderCompleted(data) {
  // FastSpring delivers the order as event.data directly, with fields at the
  // top level. NOTE: `data.order` is the order id as a STRING (a duplicate of
  // data.id), NOT a nested object — read everything off `data` itself.
  const orderId = data?.id || data?.order;
  const tags = data?.tags || {};
  const { discordUserId, discordUsername } = tags;

  console.log(`[Fulfillment] Order ${orderId} completed | Discord user: ${discordUsername} (${discordUserId})`);

  // ─── PASSIVE IDENTITY LINK ───────────────────────────────────────────────
  // A completed order proves the player controls BOTH identities: the Discord
  // ID we tagged onto the checkout, and the FastSpring account that paid. So we
  // persist the mapping here — a trusted, zero-friction link. The upsert is
  // idempotent, which dovetails with the webhook idempotency requirement.
  const fsAccountId = data?.account;
  const email = data?.customer?.email;
  if (discordUserId && fsAccountId) {
    try {
      playerLinks.upsert({ discordUserId, fsAccountId, email, linkSource: 'purchase' });
      console.log(`[Link] Linked Discord ${discordUserId} ↔ FastSpring account ${fsAccountId}`);
    } catch (err) {
      console.warn('[Link] Failed to persist identity link:', err.message);
    }
  }

  // ─── GRANT ITEMS ─────────────────────────────────────────────────────────
  // TODO: Call your game server's API here to grant the purchased item.
  // Example:
  //   const items = data?.items || [];
  //   for (const item of items) {
  //     await gameServerApi.grantItem(discordUserId, item.product, item.quantity);
  //   }
  // ─────────────────────────────────────────────────────────────────────────

  // DM the player in Discord to confirm their purchase.
  // We resolve the user *through the guild* (rather than client.users.fetch)
  // so Discord can establish the mutual-guild link required to open a DM.
  // Fetching a single member by ID uses the REST API and does not require the
  // privileged GuildMembers intent.
  if (discordUserId && client.isReady()) {
    try {
      const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
      const member = await guild.members.fetch(discordUserId);
      await member.send(
        `✅ **Purchase confirmed!** Your items from order \`${orderId}\` are being granted. Thanks for your purchase!`
      );
    } catch (err) {
      // Non-fatal: the player may have DMs from server members disabled.
      console.warn(`[Fulfillment] Could not DM player ${discordUserId}:`, err.message);
    }
  }
}

module.exports = router;
