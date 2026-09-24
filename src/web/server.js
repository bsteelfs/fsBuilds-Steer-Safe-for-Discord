const path = require('path');
const express = require('express');
const webhookRouter = require('./routes/webhook');
const authRouter = require('./routes/auth');
const checkoutRouter = require('./routes/checkout');

function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Capture the raw request body string before JSON parsing.
  // This is required for HMAC signature verification in the webhook handler —
  // once express.json() parses the body, the original bytes are gone.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    })
  );

  app.use('/webhook', webhookRouter);

  // Public branding assets (the Eggblast logo shown on the /checkout page).
  app.use('/assets', express.static(path.join(__dirname, '..', '..', 'assets')));

  // Discord OAuth (one-time account connect) and the per-buy session redirect.
  // Both build FastSpring sessions server-side, keeping identity/product out of
  // the URL. These are plain GET routes — no body parser needed.
  app.use('/auth', authRouter);
  app.use('/checkout', checkoutRouter);

  return new Promise((resolve, reject) => {
    app
      .listen(PORT, () => {
        console.log(`Web server running on port ${PORT}`);
        resolve();
      })
      .on('error', reject);
  });
}

module.exports = { startServer };
