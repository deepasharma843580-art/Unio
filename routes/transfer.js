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

// P2P Transfer
router.post('/send', auth, async (req, res) => {
  try {
    const { receiver_mobile, amount, comment } = req.body;

    if(!receiver_mobile || !amount)
      return res.status(400).json({ status:'error', message:'receiver_mobile and amount required' });

    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if(isNaN(amt) || amt < 1)
      return res.status(400).json({ status:'error', message:'Minimum ₹1' });

    const sender = await User.findById(req.user._id);
    if(!sender) return res.status(404).json({ status:'error', message:'Sender not found' });

    if(sender.balance < amt)
      return res.status(400).json({ status:'error', message:'Insufficient balance. Available: ₹'+sender.balance });

    const receiver = await User.findOne({ mobile: receiver_mobile });
    if(!receiver) return res.status(404).json({ status:'error', message:'Receiver not found' });

    if(receiver._id.equals(sender._id))
      return res.status(400).json({ status:'error', message:'Cannot send to yourself' });

    const txId   = 'UW' + String(Math.floor(10000 + Math.random()*90000));
    const now    = new Date();
    const remark = comment || ('Transfer to ' + receiver_mobile);
    const dt     = now.toLocaleString('en-IN', {
      timeZone:'Asia/Kolkata', day:'2-digit', month:'short',
      year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true
    });

    await User.findByIdAndUpdate(sender._id,   { $inc:{ balance: -amt } });
    await User.findByIdAndUpdate(receiver._id, { $inc:{ balance: +amt } });

    await Transaction.create({
      tx_id:       txId,
      sender_id:   sender._id,
      receiver_id: receiver._id,
      amount:      amt,
      type:        'transfer',
      status:      'success',
      remark:      remark,
      tx_time:     now
    });

    const sNew = await User.findById(sender._id).select('balance tg_id');
    const rNew = await User.findById(receiver._id).select('balance tg_id');

    if(sNew.tg_id) sendTG(sNew.tg_id,
`⚡ *Debit Alert*

Amount : ₹${amt}
To : ${receiver.name||'User'} (${receiver_mobile})
Txn ID : \`${txId}\`
Comment : ${comment||'—'}
Date : ${dt}

Balance : ₹${sNew.balance}
⚡ UNIO Wallet`);

    if(rNew.tg_id) sendTG(rNew.tg_id,
`⚡ *Credit Alert*

Amount : ₹${amt}
From : ${sender.name||'User'} (${sender.mobile})
Txn ID : \`${txId}\`
Comment : ${comment||'—'}
Date : ${dt}

Balance : ₹${rNew.balance}
⚡ UNIO Wallet`);

    res.json({
      status:   'success',
      tx_id:    txId,
      amount:   amt,
      receiver: { name: receiver.name, mobile: receiver.mobile }
    });

  } catch(e) {
    res.status(500).json({ status:'error', message: e.message });
  }
});

// ── Bulk Transfer ─────────────────────────────────────────────────────────────
router.post('/bulk-send', auth, async (req, res) => {
  try {
    const { mobiles, amount, comment } = req.body;

    if(!mobiles || !mobiles.length || !amount)
      return res.status(400).json({ status:'error', message:'mobiles and amount required' });

    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if(isNaN(amt) || amt < 1)
      return res.status(400).json({ status:'error', message:'Minimum ₹1 per user' });

    // Unique numbers
    const uniqueMobiles = [...new Set(mobiles.map(m => m.toString().trim()).filter(m => m.length >= 10))];
    if(!uniqueMobiles.length)
      return res.status(400).json({ status:'error', message:'Valid mobile numbers required' });

    const totalAmt = Math.round(amt * uniqueMobiles.length * 100) / 100;

    const sender = await User.findById(req.user._id);
    if(!sender) return res.status(404).json({ status:'error', message:'Sender not found' });

    if(sender.balance < totalAmt)
      return res.status(400).json({
        status:'error',
        message:`Insufficient balance. Need ₹${totalAmt}, Available: ₹${sender.balance}`
      });

    const now = new Date();
    const dt  = now.toLocaleString('en-IN', {
      timeZone:'Asia/Kolkata', day:'2-digit', month:'short',
      year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true
    });

    const results   = [];
    const failed    = [];
    let   totalSent = 0;

    for(const mobile of uniqueMobiles) {
      try {
        if(mobile === sender.mobile) { failed.push({ mobile, reason:'Cannot send to yourself' }); continue; }

        const receiver = await User.findOne({ mobile });
        if(!receiver) { failed.push({ mobile, reason:'User not found' }); continue; }

        const txId = 'UW' + String(Math.floor(10000 + Math.random()*90000));

        const session = await mongoose.startSession();
        session.startTransaction();
        try {
          await User.findByIdAndUpdate(sender._id,   { $inc:{ balance: -amt } }, { session });
          await User.findByIdAndUpdate(receiver._id, { $inc:{ balance: +amt } }, { session });
          await Transaction.create([{
            tx_id:       txId,
            sender_id:   sender._id,
            receiver_id: receiver._id,
            amount:      amt,
            type:        'transfer',
            status:      'success',
            remark:      comment || 'Bulk Transfer',
            tx_time:     now
          }], { session });
          await session.commitTransaction();
        } catch(e) {
          await session.abortTransaction();
          failed.push({ mobile, reason: e.message });
          continue;
        } finally {
          session.endSession();
        }

        totalSent += amt;
        results.push({ mobile, name: receiver.name, tx_id: txId });

        // Credit alert to receiver
        const rNew = await User.findById(receiver._id).select('tg_id balance');
        if(rNew?.tg_id) {
          sendTG(rNew.tg_id,
`⚡ *Credit Alert*

Amount : ₹${amt}
From : ${sender.name||'User'} (${sender.mobile})
Txn ID : \`${txId}\`
Comment : ${comment||'—'}
Date : ${dt}

Balance : ₹${rNew.balance}
⚡ UNIO Wallet`);
        }

      } catch(e) {
        failed.push({ mobile, reason: e.message });
      }
    }

    // Debit alert to sender
    const sNew = await User.findById(sender._id).select('tg_id balance');
    if(sNew?.tg_id) {
      sendTG(sNew.tg_id,
`⚡ *Debit Alert — Bulk*

Total Sent : ₹${totalSent.toFixed(2)}
Recipients : ${results.length}
Comment : ${comment||'—'}
Date : ${dt}

Balance : ₹${sNew.balance}
⚡ UNIO Wallet`);
    }

    res.json({
      status:      'success',
      message:     'Bulk payment done!',
      total_sent:  totalSent,
      success:     results.length,
      failed_count:failed.length,
      results,
      failed
    });

  } catch(e) {
    res.status(500).json({ status:'error', message: e.message });
  }
});

module.exports = router;
