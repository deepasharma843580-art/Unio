// models/Circle.js
const mongoose = require('mongoose');

const CircleSchema = new mongoose.Schema({
  owner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // The person added to the circle
  member_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  member_mobile: { type: String, required: true },

  // Payment mode
  payment_mode: {
    type: String,
    enum: ['approve', 'auto'],  // approve = owner approves each payment; auto = auto-deduct
    default: 'approve'
  },

  // Status of invitation
  status: {
    type: String,
    enum: ['pending', 'active', 'rejected'],
    default: 'pending'
  },

  created_at: { type: Date, default: Date.now },
  accepted_at: { type: Date }
});

// Unique: one owner-member pair
CircleSchema.index({ owner_id: 1, member_id: 1 }, { unique: true });

module.exports = mongoose.models.Circle || mongoose.model('Circle', CircleSchema);

