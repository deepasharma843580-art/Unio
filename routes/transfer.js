const router      = require('express').Router();
const mongoose    = require('mongoose');
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth }    = require('../middleware/auth');
const tg          = require('../helpers/telegram');

router.get('/lookup/:mobile', auth, async (req, res) => {
  const u = await User.findOne({ mobile: req.params.mobile }).select('name mobile wallet_id');
  if(!u) return res.json({ status:'error', message:'User not found' });
  res.json({ status:'success', name: u.name, mobile: u.mobile, wallet_id: u.wallet_id });
});

router.post('/send', auth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { receiver_mobile, amount, pin } = req.body;
    if(!receiver_mobile || !amount || !pin)
      return res.status(400).json({ status:'error', message:'receiver_mobile, amount and pin required' });
    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if(amt < 1) return res.status(400).json({ status:'error', message:'Minimum transfer amount is ₹1' });
    const sender = await User.findById(req.user._id);
    if(!(await sender.matchPin(pin)))
      return res.status(401).json({ status:'error', message:'Invalid Security PIN' });
    if(sender.balance < amt)
      return res.status(400).json({ status:'error', message:`Insufficient balance. Available: ₹${sender.balance}` });
    const receiver = await User.findOne({ mobile: receiver_mobile });
    if(!receiver) return res.status(404).json({ status:'error', message:'Receiver not found' });
    if(receiver._id.equals(sender._id))
      return res.status(400).json({ status:'error', message:'Cannot send to yourself' });
    const txId = 'TX' + Date.now() + Math.floor(Math.random()*99999);
    const now  = tg.IST();
    const dt   = tg.fmtDate(now);
    await User.findByIdAndUpdate(sender._id,   { $inc: { balance: -amt } }, { session });
    await User.findByIdAndUpdate(receiver._id, { $inc: { balance: +amt } }, { session });
    await Transaction.create([{
      tx_id: txId, sender_id: sender._id, receiver_id: receiver._id,
      amount: amt, type: 'transfer', status: 'success',
      remark: `Transfer to ${receiver_mobile}`, tx_time: now
    }], { session });
    await session.commitTransaction();
    const sNew = await User.findById(sender._id).select('balance tg_id');
    const rNew = await User.findById(receiver._id).select('balance tg_id');
    if(sNew.tg_id) tg.sendAlert(sNew.tg_id, tg.transferDebitMsg(amt, receiver_mobile, txId, dt, sNew.balance));
    if(rNew.tg_id) tg.sendAlert(rNew.tg_id, tg.transferCreditMsg(amt, sender.mobile, txId, dt, rNew.balance));
    res.json({ status:'success', tx_id: txId, amount: amt,
      receiver: { name: receiver.name, mobile: receiver.mobile } });
  } catch(e) {
    await session.abortTransaction();
    res.status(500).json({ status:'error', message: e.message });
  } finally { session.endSession(); }
});

module.exports = router;
