// models/Keeper.js
const mongoose = require('mongoose');

const keeperSchema = new mongoose.Schema({
  user_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  balance:    { type: Number, default: 0 },   // locked/saved balance
  updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Keeper || mongoose.model('Keeper', keeperSchema);

