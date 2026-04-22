const mongoose = require('mongoose');

const TxSchema = new mongoose.Schema({
  tx_id:       { type: String, default: () => 'TX' + Date.now() + Math.floor(Math.random()*99999) },
  sender_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  receiver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  amount:      { type: Number, required: true },
  fee:         { type: Number, default: 0 },
  type:        { type: String, enum: ['transfer','api','admin_add','admin_deduct','withdraw','gateway','redeem','keeper_deposit','keeper_withdraw','envelope','card_load','card_withdraw','card_pay','circle_pay','game_win','game_loss','ulite_add','ulite_withdraw','ulite_transfer'], default: 'transfer' },
  status:      { type: String, enum: ['success','pending','rejected','failed'], default: 'success' },
  remark:      { type: String, default: '' },
  tx_time:     { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', TxSchema);
