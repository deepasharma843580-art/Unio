// models/Envelope.js
const mongoose = require('mongoose');

const envelopeSchema = new mongoose.Schema({
  title:       { type: String, required: true },   // 'Diwali', 'Holi', etc.
  amount:      { type: Number, required: true },   // per user amount
  expire_at:   { type: Date,   required: true },
  active:      { type: Boolean, default: true },
  claimed_by:  [{
    user_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name:       String,
    mobile:     String,
    claimed_at: { type: Date, default: Date.now }
  }],
  created_at:  { type: Date, default: Date.now }
});

module.exports = mongoose.models.Envelope || mongoose.model('Envelope', envelopeSchema);

