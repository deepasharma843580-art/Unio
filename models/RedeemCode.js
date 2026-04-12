// models/RedeemCode.js
const mongoose = require('mongoose');

const redeemCodeSchema = new mongoose.Schema({
  product:  { type: String, required: true },  // 'google_play_10'
  label:    { type: String, required: true },  // 'Google Play ₹10'
  price:    { type: Number, required: true },  // 10
  code:     { type: String, required: true },  // actual code value
  sold:     { type: Boolean, default: false },
  sold_to:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  sold_at:  { type: Date, default: null },
  tx_id:    { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.models.RedeemCode || mongoose.model('RedeemCode', redeemCodeSchema);

