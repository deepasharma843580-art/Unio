const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const UserSchema = new mongoose.Schema({
  name:      { type: String, default: 'User', trim: true },
  mobile:    { type: String, required: true, unique: true, trim: true },
  password:  { type: String, required: true },
  login_pin: { type: String, default: '' },
  balance:   { type: Number, default: 0.00 },
  tg_id:     { type: String, default: '' },
  api_key:   { type: String, unique: true, default: () => 'UW-' + uuidv4().replace(/-/g,'').slice(0,20) },
  wallet_id: { type: String, default: () => 'UW' + Math.floor(100000 + Math.random()*900000) },
  is_banned: { type: Number, default: 0 },
  ban_until: { type: Date,   default: null },
  is_admin:  { type: Boolean, default: false },
  status:    { type: String, enum: ['active','banned'], default: 'active' },
  created_at:{ type: Date, default: Date.now }
});

UserSchema.pre('save', async function(next) {
  if(this.isModified('password'))  this.password  = await bcrypt.hash(this.password, 10);
  if(this.isModified('login_pin') && this.login_pin) this.login_pin = await bcrypt.hash(this.login_pin, 10);
  next();
});

UserSchema.methods.matchPassword = function(p) { return bcrypt.compare(p, this.password); };
UserSchema.methods.matchPin      = function(p) { return bcrypt.compare(p, this.login_pin); };

module.exports = mongoose.model('User', UserSchema);
