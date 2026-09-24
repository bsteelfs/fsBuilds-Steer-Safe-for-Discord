const { REST, Routes } = require('discord.js');
const client = require('./discord-client');
const storeCommand = require('./commands/store');
const announceCommand = require('./commands/announce');

// All slash command definitions registered with Discord.
const commands = [storeCommand.data.toJSON(), announceCommand.data.toJSON()];

async function startBot() {
  client.once('ready', () => {
    console.log(`Discord bot online as ${client.user.tag}`);
  });

  client.on('interactionCreate', async (interaction) => {
    try {
      // Slash commands.
      // NOTE: these MUST be awaited (not `return`ed). A returned promise settles
      // after this try block exits, so its rejection would escape the catch,
      // surface as an unhandled 'error' on the client, and crash the whole
      // process. Awaiting keeps any command failure contained to this handler.
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'store') {
          await storeCommand.execute(interaction);
        } else if (interaction.commandName === 'announce') {
          await announceCommand.execute(interaction);
        }
        return;
      }

      // /announce product autocomplete
      if (interaction.isAutocomplete() && interaction.commandName === 'announce') {
        await announceCommand.autocomplete(interaction);
      }
    } catch (err) {
      console.error('Unhandled interaction error:', err);
    }
  });

  // Register slash commands to the guild (fast for dev; switch to
  // Routes.applicationCommands() for a global production rollout).
  //
  // WHERE TO GET THE DISCORD SECRETS (all live in .env, never hardcode):
  //   DISCORD_BOT_TOKEN → Developer Portal → your app → Bot → Reset Token
  //                       (https://discord.com/developers/applications)
  //   DISCORD_CLIENT_ID → Developer Portal → your app → General Information →
  //                       Application ID
  //   DISCORD_GUILD_ID  → Discord app with Developer Mode on → right-click your
  //                       server → Copy Server ID
  // See .env.example for step-by-step sourcing notes on each.
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(
      process.env.DISCORD_CLIENT_ID,
      process.env.DISCORD_GUILD_ID
    ),
    { body: commands }
  );
  console.log('Slash commands registered.');

  await client.login(process.env.DISCORD_BOT_TOKEN);
}

module.exports = { startBot };
