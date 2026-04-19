const router      = require('express').Router();
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth }    = require('../middleware/auth');
const axios       = require('axios');

const BOT_TOKEN   = process.env.BOT_TOKEN   || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';
const ADMIN_TG_ID = process.env.ADMIN_TG_ID || '8509393869';
const LITE_PASS   = '8435';

function istTime() {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', hour12: true,
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

async function sendTG(tg_id, text) {
  if (!tg_id) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: tg_id, text, parse_mode: 'Markdown'
    }, { timeout: 8000 });
  } catch(e) {}
}

// Admin auth middleware
function adminAuth(req, res, next) {
  const pass = req.headers['x-lite-pass'] || req.body?.pass || req.query?.pass;
  if (pass !== LITE_PASS)
    return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /lite/me
// Token se apna balance + lite_balance fetch karo
// ─────────────────────────────────────────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('name mobile balance lite_balance wallet_id tg_id');
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });

    res.json({
      status:       'success',
      name:         user.name,
      mobile:       user.mobile,
      wallet_id:    user.wallet_id,
      balance:      parseFloat((user.balance || 0).toFixed(2)),
      lite_balance: parseFloat((user.lite_balance || 0).toFixed(2))
    });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /lite/add
// Main wallet se Lite balance mein fund move karo
// Body: { amount }
// Auth: Bearer token
// ─────────────────────────────────────────────────────────────────────────────
router.post('/add', auth, async (req, res) => {
  try {
    const amt = parseFloat(req.body.amount);
    if (isNaN(amt) || amt <= 0)
      return res.status(400).json({ status: 'error', message: 'Valid amount required' });

    // Atomic: main balance ghata, lite_balance badhao — condition: balance >= amt
    const user = await User.findOneAndUpdate(
      { _id: req.user._id, balance: { $gte: amt } },
      { $inc: { balance: -amt, lite_balance: amt } },
      { new: true }
    ).select('name mobile balance lite_balance tg_id');

    if (!user)
      return res.status(400).json({ status: 'error', message: 'Insufficient wallet balance' });

    const dt = istTime();

    await Transaction.create({
      sender_id: user._id,
      amount:    amt,
      type:      'transfer',
      status:    'success',
      remark:    `Lite Fund Add: ₹${amt} (Wallet → Lite)`,
      tx_time:   new Date()
    });

    if (user.tg_id) {
      sendTG(user.tg_id,
`💳 *Lite Fund Added!*

━━━━━━━━━━━━━━
🏦   UNIO LITE ✅
━━━━━━━━━━━━━━

💸 Added : ₹${amt}
💳 Lite Balance : ₹${user.lite_balance.toFixed(2)}
👛 Wallet Balance : ₹${user.balance.toFixed(2)}
📅 Time : ${dt}

✅ Lite mein transfer ho gaya!`
      );
    }

    res.json({
      status:       'success',
      message:      `₹${amt} Lite mein add ho gaya`,
      balance:      user.balance,
      lite_balance: user.lite_balance
    });

  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /lite/pay
// Lite balance se kisi ko payment karo
// Body: { to_mobile, amount }
// Auth: Bearer token
// ─────────────────────────────────────────────────────────────────────────────
router.post('/pay', auth, async (req, res) => {
  try {
    const { to_mobile, amount } = req.body;
    const amt = parseFloat(amount);

    if (!to_mobile)          return res.status(400).json({ status: 'error', message: 'to_mobile required' });
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ status: 'error', message: 'Valid amount required' });

    const sender = await User.findById(req.user._id);
    if (!sender) return res.status(404).json({ status: 'error', message: 'User not found' });

    if (sender.mobile === to_mobile)
      return res.status(400).json({ status: 'error', message: 'Apne aap ko pay nahi kar sakte!' });

    if ((sender.lite_balance || 0) < amt)
      return res.status(400).json({
        status: 'error',
        message: `Insufficient Lite balance. Available: ₹${(sender.lite_balance || 0).toFixed(2)}`
      });

    const receiver = await User.findOne({ mobile: to_mobile });
    if (!receiver) return res.status(404).json({ status: 'error', message: 'Receiver not found' });

    const now = new Date();
    const dt  = istTime();
    const txId = `LITE${Date.now()}`;

    // Atomic deduct from sender lite_balance
    const updSender = await User.findOneAndUpdate(
      { _id: sender._id, lite_balance: { $gte: amt } },
      { $inc: { lite_balance: -amt } },
      { new: true }
    ).select('name mobile balance lite_balance tg_id');

    if (!updSender)
      return res.status(400).json({ status: 'error', message: 'Insufficient Lite balance (concurrent check)' });

    // Credit receiver main wallet
    const updReceiver = await User.findByIdAndUpdate(
      receiver._id,
      { $inc: { balance: +amt } },
      { new: true }
    ).select('name mobile balance tg_id');

    await Transaction.create({
      sender_id:   sender._id,
      receiver_id: receiver._id,
      amount:      amt,
      type:        'transfer',
      status:      'success',
      remark:      `Lite Pay: ${sender.mobile} → ${to_mobile} | ${txId}`,
      tx_time:     now
    });

    // TG to sender
    if (updSender.tg_id) {
      sendTG(updSender.tg_id,
`💸 *Lite Payment Sent!*

━━━━━━━━━━━━━━
💳   UNIO LITE ✅
━━━━━━━━━━━━━━

➡️ To : ${updReceiver.name} (${to_mobile})
💰 Amount : ₹${amt}
💳 Lite Balance : ₹${updSender.lite_balance.toFixed(2)}
🆔 TxID : \`${txId}\`
📅 Time : ${dt}

✅ Payment successful!`
      );
    }

    // TG to receiver
    if (updReceiver.tg_id) {
      sendTG(updReceiver.tg_id,
`💰 *Payment Received!*

━━━━━━━━━━━━━━
💳   UNIO LITE ✅
━━━━━━━━━━━━━━

⬅️ From : ${updSender.name} (${sender.mobile})
💰 Amount : ₹${amt}
👛 Wallet Balance : ₹${updReceiver.balance.toFixed(2)}
🆔 TxID : \`${txId}\`
📅 Time : ${dt}

✅ Wallet mein add ho gaya!`
      );
    }

    sendTG(ADMIN_TG_ID,
`💸 *Lite Payment*\n👤 ${updSender.name} → ${updReceiver.name}\n💰 ₹${amt} | 🆔 ${txId}\n📅 ${dt}`
    );

    res.json({
      status:           'success',
      tx_id:            txId,
      amount:           amt,
      lite_balance:     updSender.lite_balance,
      receiver_name:    updReceiver.name,
      receiver_mobile:  to_mobile
    });

  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /lite/txns
// Apni last 20 Lite transactions
// Auth: Bearer token
// ─────────────────────────────────────────────────────────────────────────────
router.get('/txns', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ status: 'error', message: 'Not found' });

    const txns = await Transaction.find({
      $or: [{ sender_id: user._id }, { receiver_id: user._id }],
      remark: { $regex: /^Lite/i }
    })
      .sort({ tx_time: -1 })
      .limit(20)
      .lean();

    res.json({ status: 'success', transactions: txns });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES (pass: 8435)
// ─────────────────────────────────────────────────────────────────────────────

// GET /lite/user/:mobile?pass=8435
router.get('/user/:mobile', adminAuth, async (req, res) => {
  try {
    const user = await User.findOne({ mobile: req.params.mobile }).select('-password');
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });

    const txns = await Transaction.find({
      $or: [{ sender_id: user._id }, { receiver_id: user._id }]
    }).sort({ tx_time: -1 }).limit(10).lean();

    res.json({ status: 'success', user, transactions: txns });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// POST /lite/update-tg  (admin)
router.post('/update-tg', adminAuth, async (req, res) => {
  try {
    const { mobile, tg_id } = req.body;
    if (!mobile || !tg_id)
      return res.status(400).json({ status: 'error', message: 'mobile aur tg_id required' });

    const user = await User.findOneAndUpdate(
      { mobile },
      { tg_id: tg_id.toString() },
      { new: true }
    ).select('name mobile tg_id');

    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });

    sendTG(tg_id,
`🔔 *Telegram ID Updated!*\n\n👤 ${user.name} (${mobile})\n✅ TG linked successfully!`
    );

    res.json({ status: 'success', message: 'TG ID updated', user });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;
      
