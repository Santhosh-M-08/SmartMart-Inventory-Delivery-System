/* SmartMart Expiry — module entry (NEW FILE)  File: Backend/expiry/index.js
   Connects to MongoDB in the background, mounts /api/expiry and starts the alert job.
   If MongoDB is down, the existing /api/products routes keep working; /api/expiry/* answers 503. */
'use strict';
const mongoose = require('mongoose');
const buildRouter = require('./routes');
const { syncNotifications } = require('./service');

const URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/smartmart';
const SYNC_MINUTES = Math.max(1, Number(process.env.EXPIRY_SYNC_MINUTES) || 15);

function connect() {
  mongoose.connect(URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log('[expiry] MongoDB connected'))
    .catch(err => { console.error('[expiry] MongoDB connection failed:', err.message, '— retrying in 15s'); setTimeout(connect, 15000); });
}

function mountExpiry(app, ctx) {
  mongoose.set('strictQuery', true);
  app.use('/api/expiry', buildRouter(ctx));
  connect();

  // Automatic expiry alerts + "expired" status. Runs when the DB connects and then every few minutes.
  const run = () => { if (mongoose.connection.readyState === 1) syncNotifications(ctx).catch(e => console.error('[expiry] sync failed:', e.message)); };
  mongoose.connection.on('connected', run);
  setInterval(run, SYNC_MINUTES * 60 * 1000).unref();
}

module.exports = { mountExpiry };