const mongoose = require('mongoose');

const giftCodeSchema = new mongoose.Schema({
  code:            { type: String, required: true, unique: true, uppercase: true },
  creator_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  creator_name:    { type: String },
  creator_mobile:  { type: String },
  total_users:     { type: Number, required: true },
  per_user_amount: { type: Number, required: true },
  total_amount:    { type: Number, required: true },
  comment:         { type: String, default: '' },
  claimed_by: [{
    user_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name:       { type: String },
    mobile:     { type: String },
    amount:     { type: Number },
    claimed_at: { type: Date, default: Date.now }
  }],
  active:     { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.models.GiftCode || mongoose.model('GiftCode', giftCodeSchema);
