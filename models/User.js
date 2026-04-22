const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

function generateRefCode(tg_id) {
  const m       = tg_id.toString();
  const d0      = m[0]           || '0';
  const d8      = m[m.length-2]  || '0';
  const d9      = m[m.length-1]  || '0';
  const d3      = m[3]           || '0';
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const letter  = letters[Number(m) % letters.length] || 'X';
  return (d0 + d8 + d9 + d3 + letter).toUpperCase();
}

const UserSchema = new mongoose.Schema({
  name:          { type: String, default: 'User', trim: true },
  mobile:        { type: String, required: true, unique: true, trim: true },
  password:      { type: String, required: true },
  pin:           { type: String, default: '', select: false },
  pin_set:       { type: Boolean, default: false },
  balance:       { type: Number, default: 0.00 },
  ulite_balance: { type: Number, default: 0.00 },
  tg_id:         { type: String, default: '' },
  api_key:       { type: String, unique: true, default: () => 'UW-' + uuidv4().replace(/-/g,'').slice(0,20) },
  wallet_id:     { type: String, default: () => 'UW' + Math.floor(100000 + Math.random()*900000) },
  ref_code:      { type: String, default: '', index: true },
  is_banned:     { type: Number, default: 0 },
  ban_until:     { type: Date,   default: null },
  is_admin:      { type: Boolean, default: false },
  status:        { type: String, enum: ['active','banned'], default: 'active' },
  created_at:    { type: Date, default: Date.now }
});

UserSchema.pre('save', async function(next) {
  if (this.isModified('password'))
    this.password = await bcrypt.hash(this.password, 10);
  if (this.isModified('pin') && this.pin)
    this.pin = await bcrypt.hash(this.pin, 10);
  if (!this.ref_code && this.tg_id)
    this.ref_code = generateRefCode(this.tg_id);
  next();
});

UserSchema.methods.matchPassword = function(p) { return bcrypt.compare(p, this.password); };
UserSchema.methods.matchPin      = function(p) { return bcrypt.compare(p, this.pin); };

module.exports = mongoose.model('User', UserSchema);
module.exports.generateRefCode = generateRefCode;
