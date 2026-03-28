const mongoose = require('mongoose');

const forgotOtpSchema = new mongoose.Schema({
  mobile:        { type: String, required: true, unique: true },
  tg_id:         { type: String, required: true },
  otp:           { type: String, default: null },
  otp_expires:   { type: Date,   default: null },
  reset_token:   { type: String, default: null },
  token_expires: { type: Date,   default: null },
  createdAt:     { type: Date,   default: Date.now, expires: 900 }
});

module.exports = mongoose.models.ForgotOtp || mongoose.model('ForgotOtp', forgotOtpSchema);

