const { Client, GatewayIntentBits } = require('discord.js');

// Singleton Discord client shared between the bot interaction handler
// and the webhook handler (so the webhook can DM players after fulfillment).
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
});

module.exports = client;
