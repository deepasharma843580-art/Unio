// models/Card.js
const mongoose = require('mongoose');

const cardSchema = new mongoose.Schema({
  user_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  card_number: { type: String, required: true, unique: true }, // UW-XXXX-XXX (7 digits after UW-)
  pin:         { type: String, required: true },               // bcrypt hashed
  balance:     { type: Number, default: 0 },
  is_active:   { type: Boolean, default: true },
  created_at:  { type: Date, default: Date.now }
});

module.exports = mongoose.models.Card || mongoose.model('Card', cardSchema);
