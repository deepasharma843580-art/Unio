// routes/keeper.js
// ─────────────────────────────────────────────────────────────────
//  Balance Keeper — Savings System
//
//  USER:
//    POST /keeper/deposit   → main wallet se keeper mein daalo
//    POST /keeper/withdraw  → keeper se main wallet mein lo
//    GET  /keeper/balance   → keeper balance dekho
//
//  ADMIN:
//    GET    /keeper/admin/weeks        → weekly transactions list
//    DELETE /keeper/admin/week         → week ki transactions delete (balance safe)
// ─────────────────────────────────────────────────────────────────

const router      = require('express').Router();
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const Keeper      = require('../models/Keeper');
const { auth }    = require('../middleware/auth');
const axios       = require('axios');

const BOT_TOKEN    = process.env.BOT_TOKEN    || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '8435';

// ── Helpers ───────────────────────────────────────────────────────────────────
async function sendTG(chat_id, text) {
  if (!chat_id) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      { chat_id, text, parse_mode: 'Markdown' }, { timeout: 8000 });
  } catch(e) {}
}

function adminAuth(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (!secret || secret !== ADMIN_SECRET)
    return res.status(403).json({ status: 'error', message: 'Unauthorized' });
  next();
}

function istTime() {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
  });
}

function getWeekRange(weekOffset = -1) {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const day = ist.getUTCDay();
  const diffToMon = (day === 0) ? -6 : 1 - day;
  const monday = new Date(ist);
  monday.setUTCDate(ist.getUTCDate() + diffToMon);
  monday.setUTCHours(0, 0, 0, 0);
  const weekStart = new Date(monday.getTime() + weekOffset * 7 * 24 * 3600 * 1000);
  const weekEnd   = new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000 - 1);
  const startUTC  = new Date(weekStart.getTime() - 5.5 * 60 * 60 * 1000);
  const endUTC    = new Date(weekEnd.getTime()   - 5.5 * 60 * 60 * 1000);
  const fmt = d => d.toLocaleDateString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric' });
  return { start: startUTC, end: endUTC, label: `${fmt(startUTC)} → ${fmt(endUTC)}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /keeper/balance
// ─────────────────────────────────────────────────────────────────────────────
router.get('/balance', auth, async (req, res) => {
  try {
    const keeper = await Keeper.findOne({ user_id: req.user._id });
    const user   = await User.findById(req.user._id).select('balance name');
    res.json({
      status:          'success',
      keeper_balance:  keeper?.balance || 0,
      wallet_balance:  user?.balance   || 0,
      name:            user?.name      || ''
    });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /keeper/deposit — main wallet → keeper
// Body: { amount }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/deposit', auth, async (req, res) => {
  try {
    const { amount } = req.body;
    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(amt) || amt < 1)
      return res.status(400).json({ status: 'error', message: 'Minimum ₹1' });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });

    if (user.balance < amt)
      return res.status(400).json({ status: 'error', message: `Insufficient balance. Available: ₹${user.balance}` });

    const now  = new Date();
    const txId = 'KD' + Date.now() + Math.floor(Math.random() * 999);

    // Deduct from wallet
    await User.findByIdAndUpdate(req.user._id, { $inc: { balance: -amt } });

    // Add to keeper
    await Keeper.findOneAndUpdate(
      { user_id: req.user._id },
      { $inc: { balance: amt }, updated_at: now },
      { upsert: true, new: true }
    );

    // Transaction record
    await Transaction.create({
      tx_id:     txId,
      sender_id: req.user._id,
      amount:    amt,
      type:      'keeper_deposit',
      status:    'success',
      remark:    `💰 Keeper Deposit`,
      tx_time:   now
    });

    const updated = await Keeper.findOne({ user_id: req.user._id });
    const updUser = await User.findById(req.user._id).select('balance tg_id');

    if (updUser?.tg_id) {
      sendTG(updUser.tg_id,
`🔒 *Keeper Deposit*

━━━━━━━━━━━━
⚡  UNIO WALLET ✅
━━━━━━━━━━━━

💰 Deposited : ₹${amt}
🔒 Keeper Balance : ₹${updated.balance}
🆔 Txn ID : \`${txId}\`
📅 Date : ${istTime()}

━━━━━━━━━━━━
🪙 Wallet : ₹${updUser.balance}
━━━━━━━━━━━━`);
    }

    res.json({
      status:         'success',
      message:        `₹${amt} keeper mein save ho gaya!`,
      keeper_balance: updated.balance,
      wallet_balance: updUser.balance,
      tx_id:          txId
    });

  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /keeper/withdraw — keeper → main wallet
// Body: { amount }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/withdraw', auth, async (req, res) => {
  try {
    const { amount } = req.body;
    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(amt) || amt < 1)
      return res.status(400).json({ status: 'error', message: 'Minimum ₹1' });

    const keeper = await Keeper.findOne({ user_id: req.user._id });
    if (!keeper || keeper.balance < amt)
      return res.status(400).json({ status: 'error', message: `Keeper mein insufficient balance. Available: ₹${keeper?.balance || 0}` });

    const now  = new Date();
    const txId = 'KW' + Date.now() + Math.floor(Math.random() * 999);

    // Deduct from keeper
    await Keeper.findOneAndUpdate(
      { user_id: req.user._id },
      { $inc: { balance: -amt }, updated_at: now }
    );

    // Add to wallet
    await User.findByIdAndUpdate(req.user._id, { $inc: { balance: amt } });

    // Transaction record
    await Transaction.create({
      tx_id:       txId,
      receiver_id: req.user._id,
      amount:      amt,
      type:        'keeper_withdraw',
      status:      'success',
      remark:      `🔓 Keeper Withdrawal`,
      tx_time:     now
    });

    const updKeeper = await Keeper.findOne({ user_id: req.user._id });
    const updUser   = await User.findById(req.user._id).select('balance tg_id');

    if (updUser?.tg_id) {
      sendTG(updUser.tg_id,
`🔓 *Keeper Withdrawal*

━━━━━━━━━━━━
⚡  UNIO WALLET ✅
━━━━━━━━━━━━

💰 Withdrawn : ₹${amt}
🔒 Keeper Balance : ₹${updKeeper.balance}
🆔 Txn ID : \`${txId}\`
📅 Date : ${istTime()}

━━━━━━━━━━━━
🪙 Wallet : ₹${updUser.balance}
━━━━━━━━━━━━`);
    }

    res.json({
      status:         'success',
      message:        `₹${amt} wallet mein wapas aa gaya!`,
      keeper_balance: updKeeper.balance,
      wallet_balance: updUser.balance,
      tx_id:          txId
    });

  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — WEEKLY TRANSACTIONS LIST
// GET /keeper/admin/weeks
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/weeks', adminAuth, async (req, res) => {
  try {
    const oldest = await Transaction.findOne({
      type: { $in: ['keeper_deposit', 'keeper_withdraw'] }
    }).sort({ tx_time: 1 }).select('tx_time');

    if (!oldest) return res.json({ status: 'success', weeks: [] });

    const weeks = [];
    let offset  = -1;

    while (true) {
      const range = getWeekRange(offset);
      if (range.end < oldest.tx_time) break;

      const count = await Transaction.countDocuments({
        type:    { $in: ['keeper_deposit', 'keeper_withdraw'] },
        tx_time: { $gte: range.start, $lte: range.end }
      });

      weeks.push({ weekOffset: offset, label: range.label, count });
      offset--;
      if (offset < -104) break;
    }

    res.json({ status: 'success', weeks });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — DELETE WEEK TRANSACTIONS (balance pe koi asar nahi)
// DELETE /keeper/admin/week
// Body: { weekOffset: -1 }
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/admin/week', adminAuth, async (req, res) => {
  try {
    const weekOffset = parseInt(req.body.weekOffset ?? req.query.weekOffset ?? -1);
    if (weekOffset >= 0)
      return res.status(400).json({ status: 'error', message: 'weekOffset must be negative' });

    const range = getWeekRange(weekOffset);

    // Sirf transactions delete — keeper/wallet balance pe koi asar nahi
    const result = await Transaction.deleteMany({
      type:    { $in: ['keeper_deposit', 'keeper_withdraw'] },
      tx_time: { $gte: range.start, $lte: range.end }
    });

    res.json({
      status:  'success',
      deleted: result.deletedCount,
      week:    range.label,
      note:    'Balances safe hain — sirf transaction history delete hui'
    });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;
                                         
