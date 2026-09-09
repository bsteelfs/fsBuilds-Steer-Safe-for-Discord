const express = require('express');
const webhookRoute = require('./routes/webhook');

const app = express();

// The webhook route MUST receive the raw body. The HMAC signature is computed
// over the exact bytes FastSpring sent, so no JSON parser may run before the
// signature is verified — express.raw() keeps req.body as a Buffer.
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use('/webhook', webhookRoute);

// Health check — handy for confirming your tunnel reaches this server.
app.get('/ping', (req, res) => {
    res.send('fsBuilds Webhook Server is running!');
});

function startServer() {
    const port = process.env.PORT || 3000;
    const server = app.listen(port, () => {
        console.log(`Web server listening on port ${port}`);
    });

    // Without this, a port collision surfaces as an opaque unhandled 'error'.
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`Port ${port} is already in use — another instance of the bot is probably still running.`);
        } else {
            console.error('Web server error:', err);
        }
        process.exit(1);
    });

    return server;
}

module.exports = startServer;
