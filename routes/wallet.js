const router      = require('express').Router();
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth }    = require('../middleware/auth');
const tg          = require('../helpers/telegram');

router.get('/balance', auth, async (req, res) => {
  const u = await User.findById(req.user._id).select('balance wallet_id name mobile');
  res.json({ status:'success', balance: u.balance, wallet_id: u.wallet_id, name: u.name });
});

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

router.get('/deposit-info', auth, (req, res) => {
  const upi_id  = process.env.UPI_ID || 'Sumit302010@upi';
  const upi_name= process.env.UPI_NAME || 'UNIO%20WALLET%20SERVICES';
  res.json({
    status:   'success',
    upi_id,
    upi_name: decodeURIComponent(upi_name),
    fee_pct:  1.1,
    note:     'Pay via UPI and send screenshot to admin for manual credit'
  });
});

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
    res.json({ status:'success', message:'Withdraw request submitted. Admin will process shortly.', tx_id: txn.tx_id });
  } catch(e) { res.status(500).json({ status:'error', message: e.message }); }
});

module.exports = router;
