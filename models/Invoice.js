// models/Invoice.js
const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
  invoice_id:      { type: String, required: true, unique: true, index: true },
  merchant_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  merchant_name:   { type: String },
  merchant_mobile: { type: String },
  amount:          { type: Number, required: true },
  callback_url:    { type: String, default: null },
  order_id:        { type: String, default: null },
  note:            { type: String, default: '' },
  status:          { type: String, enum: ['pending','paid','expired'], default: 'pending' },
  expires_at:      { type: Date, required: true },
  paid_at:         { type: Date, default: null },
  tx_id:           { type: String, default: null },
  payer_mobile:    { type: String, default: null },
}, { timestamps: true });

// MongoDB auto-expire pending invoices after expires_at
invoiceSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.Invoice || mongoose.model('Invoice', invoiceSchema);

