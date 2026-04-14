const mongoose = require('mongoose');

const cardSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  card_number: {
    type: String,
    required: true,
    unique: true
    // Format: UW-XXXX-XXXX
  },
  pin: {
    type: String,
    required: true
    // Store as hashed (bcrypt)
  },
  balance: {
    type: Number,
    default: 0
  },
  is_active: {
    type: Boolean,
    default: true
  },
  created_at: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Card', cardSchema);

