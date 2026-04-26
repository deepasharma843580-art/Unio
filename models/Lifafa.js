const mongoose = require('mongoose');

// ─── Channel sub-schema ───────────────────────────────────────────────────────
// Public channel  : { url, type: 'public', admin_verified }
// Private channel : { url, type: 'private', chat_id, invite_link, admin_verified }
const ChannelSchema = new mongoose.Schema({
  url:            { type: String, required: true },
  type:           { type: String, enum: ['public', 'private'], default: 'public' },
  chat_id:        { type: String, default: '' },       // only for private
  invite_link:    { type: String, default: '' },       // only for private
  admin_verified: { type: Boolean, default: false }
}, { _id: false });

// ─── Main Lifafa schema ───────────────────────────────────────────────────────
const LifafaSchema = new mongoose.Schema({
  creator_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  creator_mobile:  { type: String },
  code:            { type: String, required: true, unique: true, uppercase: true },
  type:            { type: String, enum: ['standard', 'scratch', 'toss'], default: 'standard' },
  per_user_amount: { type: Number, default: 0 },
  min_range:       { type: Number, default: 0 },
  max_range:       { type: Number, default: 0 },
  toss_answer:     { type: String, default: '' },
  max_users:       { type: Number, required: true },
  claimed_users:   { type: Number, default: 0 },
  channels:        { type: [ChannelSchema], default: [] },   // ✅ FIX: was [String]
  access_code:     { type: String, default: '' },            // ✅ added (was missing from model)
  refer_bonus:     { type: Number, default: 0 },
  refer_fund_used: { type: Number, default: 0 },
  status:          { type: String, enum: ['active', 'expired'], default: 'active' },
  created_at:      { type: Date, default: Date.now }
});

module.exports = mongoose.models.Lifafa || mongoose.model('Lifafa', LifafaSchema);
