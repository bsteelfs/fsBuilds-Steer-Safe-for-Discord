const { Client, GatewayIntentBits, REST, Routes, Events, MessageFlags } = require('discord.js');
const storeCommand = require('./commands/store');
const announceCommand = require('./commands/announce');

// The Guilds intent is all we need: slash commands arrive regardless, and the
// webhook DMs buyers by fetching a single guild member over REST (which does
// not require the privileged GuildMembers intent).
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Each command module exports { data, execute }. Add a new command by dropping
// it in this list — registration and dispatch both read from it.
const commands = new Map([
    [storeCommand.data.name, storeCommand],
    [announceCommand.data.name, announceCommand],
]);

/**
 * Reports a command failure back to the user without throwing a SECOND error.
 * By the time a command fails it has usually already deferred or replied, and
 * calling interaction.reply() again throws "already acknowledged" — which
 * would surface as an unhandled rejection and hide the original error.
 */
async function reportError(interaction, message) {
    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
        } else {
            await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
        }
    } catch (err) {
        console.error('Could not report the error to the user:', err.message);
    }
}

async function startBot() {
    const token = process.env.DISCORD_TOKEN;
    const clientId = process.env.DISCORD_CLIENT_ID;
    const guildId = process.env.DISCORD_GUILD_ID;

    if (!token || !clientId || !guildId) {
        throw new Error('Missing DISCORD_TOKEN, DISCORD_CLIENT_ID or DISCORD_GUILD_ID in .env');
    }

    // Register slash commands to one guild — they appear instantly, which is
    // ideal for development. For a production rollout to every server, switch
    // to Routes.applicationCommands(clientId) (propagation takes up to an hour).
    const rest = new REST({ version: '10' }).setToken(token);
    try {
        console.log('Refreshing application (/) commands...');
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
            body: [...commands.values()].map((c) => c.data.toJSON()),
        });
        console.log('Successfully registered application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }

    // Events.ClientReady ('clientReady') — the bare 'ready' string is
    // deprecated in discord.js v14.27 and removed in v15.
    client.once(Events.ClientReady, () => {
        console.log(`Bot online! Logged in as ${client.user.tag}`);
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const command = commands.get(interaction.commandName);
        if (!command) return;

        try {
            // Awaited (not returned) so a rejection is caught HERE rather than
            // escaping as an unhandled 'error' on the client.
            await command.execute(interaction);
        } catch (error) {
            console.error(`[/${interaction.commandName}] Unhandled error:`, error);
            await reportError(interaction, 'Something went wrong running that command. Please try again.');
        }
    });

    await client.login(token);
}

module.exports = { startBot, client };
