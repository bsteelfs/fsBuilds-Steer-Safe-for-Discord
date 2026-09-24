require('dotenv').config();
const { startServer } = require('./web/server');
const { startBot } = require('./bot');

async function main() {
  // Start the Express server first so the /webhook endpoint is ready before the
  // bot begins accepting Discord interactions.
  await startServer();
  await startBot();
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
