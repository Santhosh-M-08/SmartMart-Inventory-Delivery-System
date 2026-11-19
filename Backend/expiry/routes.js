/* SmartMart Expiry — REST routes (NEW FILE)  File: Backend/expiry/routes.js
   Mounted at /api/expiry by expiry/index.js. Errors use the same shape as your products API:
   { error: "message" }  or  { errors: { field: "message" } } */
'use strict';
const express = require('express');
const mongoose = require('mongoose');
const S = require('./service');
const R = require('./rules');

module.exports = function buildRouter(ctx) {
  const router = express.Router();
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const validId = (req, res, next) => (mongoose.isValidObjectId(req.params.id) ? next() : res.status(400).json({ error: 'Invalid id.' }));

  // Health is always available so you can see the real database state (nothing is faked).
  router.get('/health', (req, res) => res.json({
    ok: mongoose.connection.readyState === 1,
    database: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown',
    today: R.todayISO(), timeZone: R.STORE_TZ
  }));

  router.use((req, res, next) => (mongoose.connection.readyState === 1 ? next()
    : res.status(503).json({ error: 'Expiry database is not connected. Check MONGODB_URI and that MongoDB is running.' })));

  /* settings */
  router.get('/settings', wrap(async (req, res) => res.json(await S.getSettings())));
  router.put('/settings', wrap(async (req, res) => res.json(await S.saveSettings(req.body, ctx))));
  router.post('/settings/reset', wrap(async (req, res) => res.json(await S.resetSettings(ctx))));

  /* batches */
  router.get('/batches', wrap(async (req, res) => res.json(await S.listBatches(ctx, req.query))));
  router.post('/batches', wrap(async (req, res) => res.status(201).json(await S.addBatch(ctx, req.body || {}))));
  router.get('/batches/:id', validId, wrap(async (req, res) => res.json(await S.getBatch(ctx, req.params.id))));
  router.patch('/batches/:id/discount', validId, wrap(async (req, res) => res.json(await S.setOverride(ctx, req.params.id, req.body))));
  router.post('/batches/:id/write-off', validId, wrap(async (req, res) => res.json(await S.writeOff(ctx, req.params.id))));
  router.delete('/batches/:id', validId, wrap(async (req, res) => { await S.deleteBatch(req.params.id); res.sendStatus(204); }));

  /* dashboard + analytics */
  router.get('/summary', wrap(async (req, res) => res.json(await S.summary(ctx))));
  router.get('/analytics', wrap(async (req, res) => res.json(await S.analytics(ctx, ['all', 'actual', 'sample'].includes(req.query.scope) ? req.query.scope : 'all'))));
  router.get('/suggestions', wrap(async (req, res) => res.json(await S.suggestions(ctx, Number(req.query.limit) || 6))));

  /* notifications */
  router.get('/notifications', wrap(async (req, res) => res.json(await S.listNotifications(req.query))));
  router.post('/notifications/read-all', wrap(async (req, res) => res.json(await S.markAllRead())));
  router.patch('/notifications/:id/read', validId, wrap(async (req, res) => res.json(await S.markRead(req.params.id))));
  router.post('/sync', wrap(async (req, res) => res.json(await S.syncNotifications(ctx))));

  /* storefront: offers, price validation, checkout */
  router.get('/offers', wrap(async (req, res) => res.json(await S.offers(ctx))));
  router.post('/quote', wrap(async (req, res) => res.json(await S.quote(ctx, req.body))));
  router.post('/checkout', wrap(async (req, res) => res.status(201).json(await S.checkout(ctx, req.body || {}))));

  router.use((req, res) => res.status(404).json({ error: 'Unknown expiry endpoint.' }));
  router.use((err, req, res, next) => {                 // eslint-disable-line no-unused-vars
    if (err instanceof S.HttpError) return res.status(err.status).json(err.errors ? { error: err.message, errors: err.errors } : { error: err.message });
    if (err && err.code === 11000) return res.status(409).json({ error: 'Duplicate record.' });
    console.error('[expiry]', err);
    res.status(500).json({ error: 'Unexpected server error.' });
  });
  return router;
};