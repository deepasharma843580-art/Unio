// routes/lite.js
// ─────────────────────────────────────────────────────────────────────────────
//  UNIO Lite — All Routes
//
//  GET  /lite/balance
//  GET  /lite/transactions?limit=15
//  POST /lite/lookup
//  POST /lite/pay
// ─────────────────────────────────────────────────────────────────────────────

const router      = require('express').Router();
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth }    = require('../middleware/auth');
const axios       = require('axios');

const BOT_TOKEN   = process.env.BOT_TOKEN   || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';
const ADMIN_TG_ID = process.env.ADMIN_TG_ID || '8509393869';

// ── Helpers ───────────────────────────────────────────────────────────────────
async function sendTG(tg_id, text) {
  if (!tg_id) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      { chat_id: tg_id, text, parse_mode: 'Markdown' },
      { timeout: 8000 }
    );
  } catch(e) {}
}

function istNow() {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', hour12: true,
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function makeTxId() {
  return 'UL' + Date.now() + Math.floor(Math.random() * 9000 + 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /lite/balance
// Response: name, mobile, balance, wallet_id, avatar
// ─────────────────────────────────────────────────────────────────────────────
router.get('/balance', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('name mobile balance wallet_id tg_id');

    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });

    res.json({
      status:    'success',
      name:      user.name,
      mobile:    user.mobile,
      balance:   parseFloat(user.balance || 0).toFixed(2),
      wallet_id: user.wallet_id,
      avatar:    (user.name || 'U')[0].toUpperCase(),
    });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /lite/transactions?limit=15
// Recent txns with direction (credit/debit) from current user's POV
// ─────────────────────────────────────────────────────────────────────────────
router.get('/transactions', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const limit  = Math.min(parseInt(req.query.limit) || 15, 50);

    const txns = await Transaction.find({
      $or: [{ sender_id: userId }, { receiver_id: userId }]
    })
      .sort({ tx_time: -1, createdAt: -1 })
      .limit(limit)
      .populate('sender_id',   'name mobile')
      .populate('receiver_id', 'name mobile')
      .lean();

    const result = txns.map(t => {
      const isCr = t.receiver_id?._id?.toString() === userId.toString();
      return {
        tx_id:     t.tx_id || t._id,
        direction: isCr ? 'credit' : 'debit',
        amount:    parseFloat(t.amount || 0).toFixed(2),
        remark:    t.remark || (isCr ? 'Received' : 'Sent'),
        status:    t.status || 'success',
        other:     isCr
          ? (t.sender_id   ? `${t.sender_id.name} · ${t.sender_id.mobile}`   : 'System')
          : (t.receiver_id ? `${t.receiver_id.name} · ${t.receiver_id.mobile}` : 'System'),
        tx_time:   t.tx_time || t.createdAt,
      };
    });

    res.json({ status: 'success', transactions: result });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /lite/lookup
// Body: { mobile }
// Pay form mein naam chip dikhane ke liye
// ─────────────────────────────────────────────────────────────────────────────
router.post('/lookup', auth, async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile) return res.status(400).json({ status: 'error', message: 'Mobile required' });

    if (mobile.toString() === req.user.mobile?.toString())
      return res.json({ status: 'error', message: 'Apna number nahi daal sakte' });

    const user = await User.findOne({ mobile: mobile.toString() }).select('name mobile');
    if (!user) return res.json({ status: 'error', message: 'User not found' });

    res.json({ status: 'success', name: user.name, mobile: user.mobile });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /lite/pay
// Body: { to_mobile, amount, comment? }
// Wallet to wallet transfer + TG alerts dono ko
// ─────────────────────────────────────────────────────────────────────────────
router.post('/pay', auth, async (req, res) => {
  try {
    const { to_mobile, amount, comment } = req.body;

    if (!to_mobile || !amount)
      return res.status(400).json({ status: 'error', message: 'to_mobile aur amount required hai' });

    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(amt) || amt < 1)
      return res.status(400).json({ status: 'error', message: 'Minimum ₹1 required' });

    // Sender
    const sender = await User.findById(req.user._id);
    if (!sender) return res.status(404).json({ status: 'error', message: 'Sender not found' });

    // Self transfer block
    if (sender.mobile === to_mobile.toString())
      return res.json({ status: 'error', message: 'Apne aap ko transfer nahi kar sakte' });

    // Receiver
    const receiver = await User.findOne({ mobile: to_mobile.toString() });
    if (!receiver)
      return res.json({ status: 'error', message: `${to_mobile} UNIO pe registered nahi hai` });

    // Balance check
    if (parseFloat(sender.balance) < amt)
      return res.json({
        status:  'error',
        message: `Balance kam hai. Available: ₹${parseFloat(sender.balance).toFixed(2)}`
      });

    // Deduct & Credit
    await User.findByIdAndUpdate(sender._id,   { $inc: { balance: -amt } });
    await User.findByIdAndUpdate(receiver._id, { $inc: { balance: +amt } });

    const tx_id = makeTxId();
    const note  = (comment || 'UNIO Lite Payment').toString().trim();
    const now   = new Date();
    const dt    = istNow();

    // Transaction record
    await Transaction.create({
      tx_id,
      sender_id:   sender._id,
      receiver_id: receiver._id,
      amount:      amt,
      type:        'transfer',
      status:      'success',
      remark:      note,
      tx_time:     now,
    });

    // TG to sender
    if (sender.tg_id) {
      sendTG(sender.tg_id,
`💸 *Payment Sent — UNIO Lite*

━━━━━━━━━━━━━━
👤 To     : ${receiver.name} (\`${receiver.mobile}\`)
💰 Amount : ₹${amt}
💬 Note   : ${note}
🆔 Txn ID : \`${tx_id}\`
📅 Time   : ${dt}
━━━━━━━━━━━━━━
🏦 Balance : ₹${(parseFloat(sender.balance) - amt).toFixed(2)}`
      );
    }

    // TG to receiver
    if (receiver.tg_id) {
      sendTG(receiver.tg_id,
`💰 *Payment Received — UNIO Lite*

━━━━━━━━━━━━━━
👤 From   : ${sender.name} (\`${sender.mobile}\`)
💰 Amount : ₹${amt}
💬 Note   : ${note}
🆔 Txn ID : \`${tx_id}\`
📅 Time   : ${dt}
━━━━━━━━━━━━━━
✅ Balance mein add ho gaya!`
      );
    }

    // TG to admin
    sendTG(ADMIN_TG_ID,
`🔁 *Lite Transfer*

👤 ${sender.name} (${sender.mobile}) → ${receiver.name} (${receiver.mobile})
💰 ₹${amt} | 🆔 \`${tx_id}\`
📅 ${dt}`
    );

    res.json({
      status:  'success',
      message: `₹${amt} successfully sent to ${receiver.name}!`,
      tx_id,
      amount:  amt,
      to_name: receiver.name,
      to_mobile: receiver.mobile,
      timestamp: dt,
    });

  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;
  
