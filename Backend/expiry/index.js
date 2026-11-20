'use strict';

const buildRouter = require('./routes');
const { syncNotifications } = require('./service');
const { syncProducts } = require('./models');

const SYNC_MINUTES = Math.max(
    1,
    Number(process.env.EXPIRY_SYNC_MINUTES) || 15
);

function mountExpiry(app, ctx) {
    // Synchronize products with SQLite.
    syncProducts(ctx.readProducts());

    // Register expiry API routes.
    app.use('/api/expiry', buildRouter(ctx));

    // Create notifications when the server starts.
    try {
        const result = syncNotifications(ctx);
        console.log(
            `[expiry] SQLite ready; notifications created: ${result.created}`
        );
    } catch (error) {
        console.error('[expiry] Initial notification sync failed:', error);
    }

    // Periodically update expiry notifications.
    const timer = setInterval(() => {
        try {
            syncNotifications(ctx);
        } catch (error) {
            console.error('[expiry] Notification sync failed:', error);
        }
    }, SYNC_MINUTES * 60 * 1000);

    if (timer.unref) timer.unref();
}

module.exports = { mountExpiry };