
'use strict';

const express = require('express');
const S = require('./service');
const R = require('./rules');
const { db } = require('./models');

module.exports = function buildRouter(ctx) {
    const router = express.Router();

    const wrap = fn => (req, res, next) =>
        Promise.resolve(fn(req, res, next)).catch(next);

    const validId = (req, res, next) => {
        const id = String(req.params.id || '');

        if (!id || id.length > 100) {
            return res.status(400).json({ error: 'Invalid id.' });
        }

        next();
    };

    router.get('/health', (req, res) => {
        try {
            db.prepare('SELECT 1').get();

            res.json({
                ok: true,
                database: 'connected',
                today: R.todayISO(),
                timeZone: R.STORE_TZ
            });
        } catch (error) {
            res.status(503).json({
                ok: false,
                database: 'disconnected'
            });
        }
    });

    router.get('/settings', wrap((req, res) =>
        res.json(S.getSettings())
    ));

    router.put('/settings', wrap((req, res) =>
        res.json(S.saveSettings(req.body, ctx))
    ));

    router.post('/settings/reset', wrap((req, res) =>
        res.json(S.resetSettings(ctx))
    ));

    router.get('/batches', wrap((req, res) =>
        res.json(S.listBatches(ctx, req.query))
    ));

    router.post('/batches', wrap((req, res) =>
        res.status(201).json(S.addBatch(ctx, req.body || {}))
    ));

    router.get('/batches/:id', validId, wrap((req, res) =>
        res.json(S.getBatch(ctx, req.params.id))
    ));

    router.patch('/batches/:id/discount', validId, wrap((req, res) =>
        res.json(S.setOverride(ctx, req.params.id, req.body))
    ));

    router.post('/batches/:id/write-off', validId, wrap((req, res) =>
        res.json(S.writeOff(ctx, req.params.id))
    ));

    router.delete('/batches/:id', validId, wrap((req, res) => {
        S.deleteBatch(req.params.id);
        res.sendStatus(204);
    }));

    router.get('/summary', wrap((req, res) =>
        res.json(S.summary(ctx))
    ));

    router.get('/analytics', wrap((req, res) =>
        res.json(S.analytics(
            ctx,
            ['all', 'actual', 'sample'].includes(req.query.scope)
                ? req.query.scope : 'all'
        ))
    ));

    router.get('/suggestions', wrap((req, res) =>
        res.json(S.suggestions(ctx, Number(req.query.limit) || 6))
    ));

    router.get('/notifications', wrap((req, res) =>
        res.json(S.listNotifications(req.query))
    ));

    router.post('/notifications/read-all', wrap((req, res) =>
        res.json(S.markAllRead())
    ));

    router.patch('/notifications/:id/read', validId, wrap((req, res) =>
        res.json(S.markRead(req.params.id))
    ));

    router.post('/sync', wrap((req, res) =>
        res.json(S.syncNotifications(ctx))
    ));

    router.get('/offers', wrap((req, res) =>
        res.json(S.offers(ctx))
    ));

    router.post('/quote', wrap((req, res) =>
        res.json(S.quote(ctx, req.body))
    ));

    router.post('/checkout', wrap((req, res) =>
        res.status(201).json(S.checkout(ctx, req.body || {}))
    ));

    router.use((req, res) =>
        res.status(404).json({ error: 'Unknown expiry endpoint.' })
    );

    router.use((err, req, res, next) => {
        if (err instanceof S.HttpError) {
            return res.status(err.status).json(
                err.errors
                    ? { error: err.message, errors: err.errors }
                    : { error: err.message }
            );
        }

        console.error('[expiry]', err);
        res.status(500).json({
            error: 'Unexpected server error.'
        });
    });

    return router;
};
