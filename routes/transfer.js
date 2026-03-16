const router      = require('express').Router();
const mongoose    = require('mongoose');
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth }    = require('../middleware/auth');
const axios       = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';

async function sendTG(tg_id, text) {
  if(!tg_id) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id:    tg_id,
      text:       text,
      parse_mode: 'Markdown'
    }, { timeout: 8000 });
  } catch(e) {}
}

// Lookup
router.get('/lookup/:mobile', auth, async (req, res) => {
  try {
    const u = await User.findOne({ mobile: req.params.mobile }).select('name mobile');
    if(!u) return res.json({ status:'error', message:'User not found' });
    res.json({ status:'success', name: u.name, mobile: u.mobile });
  } catch(e) {
    res.status(500).json({ status:'error', message: e.message });
  }
});

// P2P Transfer — no PIN needed
router.post('/send', auth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { receiver_mobile, amount } = req.body;

    if(!receiver_mobile || !amount)
      return res.status(400).json({ status:'error', message:'receiver_mobile and amount required' });

    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if(isNaN(amt) || amt < 1)
      return res.status(400).json({ status:'error', message:'Minimum ₹1' });

    const sender = await User.findById(req.user._id);
    if(!sender)
      return res.status(404).json({ status:'error', message:'Sender not found' });

    if(sender.balance < amt)
      return res.status(400).json({ status:'error', message:'Insufficient balance. Available: ₹'+sender.balance });

    const receiver = await User.findOne({ mobile: receiver_mobile });
    if(!receiver)
      return res.status(404).json({ status:'error', message:'Receiver not found' });

    if(receiver._id.equals(sender._id))
      return res.status(400).json({ status:'error', message:'Cannot send to yourself' });

    const txId = 'TX' + Date.now() + Math.floor(Math.random()*99999);
    const now  = new Date();
    const dt   = now.toLocaleString('en-IN', {
      timeZone:'Asia/Kolkata', day:'2-digit', month:'short',
      year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true
    });

    await User.findByIdAndUpdate(sender._id,   { $inc:{ balance: -amt } }, { session });
    await User.findByIdAndUpdate(receiver._id, { $inc:{ balance: +amt } }, { session });

    await Transaction.create([{
      tx_id:       txId,
      sender_id:   sender._id,
      receiver_id: receiver._id,
      amount:      amt,
      type:        'transfer',
      status:      'success',
      remark:      'Transfer to ' + receiver_mobile,
      tx_time:     now
    }], { session });

    await session.commitTransaction();

    const sNew = await User.findById(sender._id).select('balance tg_id');
    const rNew = await User.findById(receiver._id).select('balance tg_id');

    // Debit Alert
    if(sNew.tg_id) {
      sendTG(sNew.tg_id,
`🔴 *DEBIT ALERT*

━━━━━━━━━━━━━━
🔴   UNIO WALLET ✅ 🔴
━━━━━━━━━━━━━━

💰 Amount : ₹${amt}
👤 Sent To : \`${receiver_mobile}\`
👤 Name : ${receiver.name||'User'}
🆔 Txn ID : \`${txId}\`
📋 Type : P2P TRANSFER
📅 Date : ${dt}

━━━━━━━━━━━━━━
🪙 Balance : ₹${sNew.balance}
━━━━━━━━━━━━━━

❌ Amount Debited through UNIO Wallet 🔴`
      );
    }

    // Credit Alert
    if(rNew.tg_id) {
      sendTG(rNew.tg_id,
`🟢 *CREDIT ALERT*

━━━━━━━━━━━━━━
🟢   UNIO WALLET ✅ 🟢
━━━━━━━━━━━━━━

💰 Amount : ₹${amt}
👤 From : \`${sender.mobile}\`
👤 Name : ${sender.name||'User'}
🆔 Txn ID : \`${txId}\`
📋 Type : P2P TRANSFER
📅 Date : ${dt}

━━━━━━━━━━━━━━
🪙 Balance : ₹${rNew.balance}
━━━━━━━━━━━━━━

✅ Amount Credited through UNIO Wallet 🟢`
      );
    }

    res.json({
      status:   'success',
      tx_id:    txId,
      amount:   amt,
      receiver: { name: receiver.name, mobile: receiver.mobile }
    });

  } catch(e) {
    await session.abortTransaction();
    res.status(500).json({ status:'error', message: e.message });
  } finally {
    session.endSession();
  }
});

module.exports = router;
