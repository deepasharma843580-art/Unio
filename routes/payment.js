const router      = require('express').Router();
const mongoose    = require('mongoose');
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const { apiKeyAuth } = require('../middleware/auth');
const tg          = require('../helpers/telegram');

router.get('/', apiKeyAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const to     = String(req.query.to  || '').trim();
    const remark = String(req.query.remark || 'API Payment').trim();
    const txnRef = String(req.query.txn || '').trim();
    const rawAmt = String(req.query.amt || '').replace(/[^0-9.]/g,'');
    const amt    = Math.round(parseFloat(rawAmt) * 100) / 100;
    if(!to || !amt)
      return res.json({ status:'error', message:'Missing params', usage:'/payment?key=YOUR_KEY&to=MOBILE&amt=AMOUNT' });
    if(isNaN(amt) || amt < 1)
      return res.json({ status:'error', message:'Minimum amount is ₹1' });
    if(amt > 100000)
      return res.json({ status:'error', message:'Maximum ₹1,00,000 per transaction' });
    if(txnRef) {
      const exists = await Transaction.findOne({ remark: txnRef });
      if(exists) return res.json({ status:'error', message:'Already Claimed! This Transaction ID is used.' });
    }
    const sender   = await User.findById(req.apiUser._id);
    const receiver = await User.findOne({ mobile: to });
    if(!receiver) return res.json({ status:'error', message:`Receiver ${to} not found` });
    if(sender.balance < amt) return res.json({ status:'error', message:'Admin Balance Low' });
    const txId = 'TX' + Date.now() + Math.floor(Math.random()*99999);
    const now  = tg.IST();
    const dt   = tg.fmtDate(now);
    const label= tg.txnLabel(txId, amt);
    await User.findByIdAndUpdate(sender._id,   { $inc: { balance: -amt } }, { session });
    await User.findByIdAndUpdate(receiver._id, { $inc: { balance: +amt } }, { session });
    await Transaction.create([{
      tx_id: txId, sender_id: sender._id, receiver_id: receiver._id,
      amount: amt, type: 'api', status: 'success',
      remark: txnRef || remark, tx_time: now
    }], { session });
    await session.commitTransaction();
    const sNew = await User.findById(sender._id).select('balance tg_id name mobile');
    const rNew = await User.findById(receiver._id).select('balance tg_id name mobile');
    const sDisplay = `${sNew.name}\nNumber: ${sNew.mobile}`;
    const rDisplay = `${rNew.name}\nNumber: ${rNew.mobile}`;
    if(sNew.tg_id) tg.sendAlert(sNew.tg_id, tg.debitMsg(amt, rDisplay, label, dt, sNew.balance));
    if(rNew.tg_id) tg.sendAlert(rNew.tg_id, tg.creditMsg(amt, sDisplay, label, dt, rNew.balance));
    if(process.env.ADMIN_TG_ID) tg.sendAlert(process.env.ADMIN_TG_ID, tg.adminApiMsg(amt, sDisplay, rDisplay, label, dt));
    res.json({ status:'success', message:'Transfer Done', amount: amt, txn: label, tx_id: txId });
  } catch(e) {
    await session.abortTransaction();
    res.json({ status:'error', message: e.message });
  } finally { session.endSession(); }
});

router.get('/balance', apiKeyAuth, async (req, res) => {
  const u = await User.findById(req.apiUser._id).select('balance wallet_id name mobile');
  res.json({ status:'success', balance: u.balance, wallet_id: u.wallet_id, name: u.name, mobile: u.mobile });
});

router.get('/verify', apiKeyAuth, async (req, res) => {
  const mobile = String(req.query.mobile || req.query.to || '').trim();
  const u = await User.findOne({ mobile }).select('name mobile wallet_id');
  if(!u) return res.json({ status:'error', exists: false, message:'User not found' });
  res.json({ status:'success', exists: true, name: u.name, mobile: u.mobile, wallet_id: u.wallet_id });
});

module.exports = router;
