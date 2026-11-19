/* SmartMart Expiry — MongoDB models (NEW FILE)  File: Backend/expiry/models.js */
'use strict';
const mongoose = require('mongoose');
const { Schema } = mongoose;

/* One document per delivery of a product with its own expiry date. */
const batchSchema = new Schema({
  productId: { type: Number, required: true, index: true },   // id from the existing products API (id: number)
  batchNo: { type: String, required: true, uppercase: true, trim: true },
  qtyReceived: { type: Number, required: true, min: 0 },
  qtyAvailable: { type: Number, required: true, min: 0 },
  expiryDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },   // store-local calendar date
  receivedDate: { type: String },
  override: {
    mode: { type: String, enum: ['custom', 'none'] },          // absent = automatic (store settings)
    pct: Number,
    startNow: Boolean
  },
  writtenOff: { type: Boolean, default: false },
  source: { type: String, enum: ['actual', 'sample'], default: 'actual', index: true }   // demo data is always flagged
}, { timestamps: true });
batchSchema.index({ productId: 1, batchNo: 1 }, { unique: true });
batchSchema.index({ expiryDate: 1 });

/* One document per sale line taken from a batch (powers revenue, discount and suggestions). */
const saleSchema = new Schema({
  batchId: { type: Schema.Types.ObjectId, ref: 'ExpiryBatch', required: true, index: true },
  productId: { type: Number, required: true },
  date: { type: String, required: true },                      // store-local YYYY-MM-DD
  qty: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true },
  basePrice: { type: Number, required: true },
  discountPct: { type: Number, default: 0 },
  orderRef: { type: String }
}, { timestamps: true });
saleSchema.index({ productId: 1, date: 1 });

/* Single settings document (key = "default"). */
const settingsSchema = new Schema({
  key: { type: String, default: 'default', unique: true },
  enabled: { type: Boolean, default: true },
  activationDays: { type: Number, default: 3 },
  discountPercent: { type: Number, default: 50 },
  warningDays: { type: Number, default: 7 }
}, { timestamps: true });

/* eventKey = "<batchId>|<stage>" with a UNIQUE index → the same event can never be stored twice. */
const notificationSchema = new Schema({
  eventKey: { type: String, required: true, unique: true },
  type: { type: String, enum: ['warning', 'discount', 'urgent', 'expired'], required: true },
  title: String,
  message: String,
  batchId: { type: Schema.Types.ObjectId, ref: 'ExpiryBatch', index: true },
  productId: Number,
  read: { type: Boolean, default: false },
  suppressed: { type: Boolean, default: false }                // skipped earlier stages: remembered, never shown
}, { timestamps: true });
notificationSchema.index({ createdAt: -1 });

module.exports = {
  Batch: mongoose.models.ExpiryBatch || mongoose.model('ExpiryBatch', batchSchema),
  Sale: mongoose.models.ExpirySale || mongoose.model('ExpirySale', saleSchema),
  Settings: mongoose.models.ExpirySettings || mongoose.model('ExpirySettings', settingsSchema),
  Notification: mongoose.models.ExpiryNotification || mongoose.model('ExpiryNotification', notificationSchema)
};