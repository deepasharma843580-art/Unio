// models/GameConfig.js
const mongoose = require('mongoose');

const gameConfigSchema = new mongoose.Schema({
  game:       { type: String, required: true, unique: true }, // 'coin' | 'aviator'
  win_chance: { type: Number, default: 70 },   // % chance user wins (0-100)
  min_bet:    { type: Number, default: 5 },
  multiplier: { type: Number, default: 2 },    // coin = 2x, aviator varies
  extra_win:  { type: Number, default: 3 },    // 3% extra on win
  updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.models.GameConfig || mongoose.model('GameConfig', gameConfigSchema);

