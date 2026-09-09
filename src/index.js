// quiet: true suppresses dotenv's startup banner/tips.
require('dotenv').config({ quiet: true });

const { startBot } = require('./bot');
const startServer = require('./web/server');

// A rejected promise nobody caught would otherwise kill the process silently
// (or, on older Node, only print a warning). Log it loudly instead — the bot
// should survive a one-off Discord/FastSpring API hiccup.
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
});

async function bootstrap() {
    try {
        console.log('Starting fsBuilds monetization bot...');

        // Webhook server first, so it's already listening when FastSpring
        // starts delivering events for anything bought during startup.
        startServer();
        await startBot();

        console.log('System online.');
    } catch (error) {
        console.error('Failed to start the application:', error);
        process.exit(1);
    }
}

bootstrap();
