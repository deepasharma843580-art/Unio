const mongoose = require('mongoose');

const DepositSchema = new mongoose.Schema({
    uid: { type: String, required: true },
    mobile: { type: String },
    amount: { type: String, required: true },
    txn_id: { type: String, sparse: true },
    ref_id: { type: String, unique: true },
    sender: { type: String, default: "Unknown" },
    status: { type: String, default: "pending" },
    created_at: { type: Date, default: Date.now },
    paid_at: { type: Date }
});

module.exports = mongoose.model('Deposit', DepositSchema);
