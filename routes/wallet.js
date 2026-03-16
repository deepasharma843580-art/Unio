const router      = require('express').Router();
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth }    = require('../middleware/auth');
const tg          = require('../helpers/telegram');

// Balance
router.get('/balance', auth, async (req, res) => {
  const u = await User.findById(req.user._id).select('balance wallet_id name mobile');
  res.json({ status:'success', balance: u.balance, wallet_id: u.wallet_id, name: u.name });
});

// Transactions history
router.get('/transactions', auth, async (req, res) => {
  try {
    const txns = await Transaction.find({
      $or: [{ sender_id: req.user._id }, { receiver_id: req.user._id }]
    }).sort({ tx_time: -1 }).limit(50)
      .populate('sender_id',   'name mobile')
      .populate('receiver_id', 'name mobile');
    res.json({ status:'success', transactions: txns });
  } catch(e) { res.status(500).json({ status:'error', message: e.message }); }
});

// Deposit info
router.get('/deposit-info', auth, (req, res) => {
  res.json({
    status:   'success',
    upi_id:   process.env.UPI_ID || 'sumitsharmaji001@ptyes',
    fee_pct:  0,
    note:     'Pay via UPI then submit UTR number'
  });
});

// Deposit UTR request
router.post('/deposit-request', auth, async (req, res) => {
  try {
    const { utr, amount } = req.body;
    const amt = parseFloat(amount);
    if(!utr) return res.status(400).json({ status:'error', message:'UTR required' });
    if(amt < 1) return res.status(400).json({ status:'error', message:'Minimum ₹1' });
    const user = await User.findById(req.user._id);
    const existing = await Transaction.findOne({ remark: 'UTR:' + utr });
    if(existing) return res.status(400).json({ status:'error', message:'This UTR already submitted!' });
    await Transaction.create({
      receiver_id: user._id, amount: amt,
      type: 'transfer', status: 'pending',
      remark: 'UTR:' + utr
    });
    if(process.env.ADMIN_TG_ID) {
      tg.sendAlert(process.env.ADMIN_TG_ID,
        `💳 *NEW DEPOSIT REQUEST*\n\n👤 User: \`${user.mobile}\`\n💰 Amount: ₹${amt}\n🔖 UTR: \`${utr}\`\n⏳ Status: Pending\n\n_UNIO Deposit System_`
      );
    }
    res.json({ status:'success', message:'Request submitted! Admin will verify shortly.' });
  } catch(e) { res.status(500).json({ status:'error', message: e.message }); }
});

// Withdraw request
router.post('/withdraw', auth, async (req, res) => {
  try {
    const { upi, amount } = req.body;
    const amt = parseFloat(amount);
    if(!upi)     return res.status(400).json({ status:'error', message:'UPI ID required' });
    if(amt < 10) return res.status(400).json({ status:'error', message:'Minimum withdrawal is ₹10' });
    const user = await User.findById(req.user._id);
    if(user.balance < amt) return res.status(400).json({ status:'error', message:'Insufficient balance' });
    user.balance = parseFloat((user.balance - amt).toFixed(2));
    await user.save();
    const txn = await Transaction.create({
      sender_id: user._id, amount: amt,
      type: 'withdraw', status: 'pending', remark: upi
    });
    if(process.env.ADMIN_TG_ID) {
      tg.sendAlert(process.env.ADMIN_TG_ID, tg.withdrawMsg(user.mobile, amt, upi));
    }
    res.json({ status:'success', message:'Withdraw request submitted!', tx_id: txn.tx_id });
  } catch(e) { res.status(500).json({ status:'error', message: e.message }); }
});

module.exports = router;
