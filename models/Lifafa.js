const mongoose = require('mongoose');

const LifafaSchema = new mongoose.Schema({
  creator_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  creator_mobile:  { type: String },
  code:            { type: String, required: true, unique: true, uppercase: true },
  type:            { type: String, enum: ['standard','scratch','toss'], default: 'standard' },
  per_user_amount: { type: Number, default: 0 },
  min_range:       { type: Number, default: 0 },
  max_range:       { type: Number, default: 0 },
  toss_answer:     { type: String, default: '' },
  max_users:       { type: Number, required: true },
  claimed_users:   { type: Number, default: 0 },
  channels:        { type: [String], default: [] },
  status:          { type: String, enum: ['active','expired'], default: 'active' },
  created_at:      { type: Date, default: Date.now }
});

module.exports = mongoose.model('Lifafa', LifafaSchema);
