// routes/envelope.js
const router      = require('express').Router();
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const Envelope    = require('../models/Envelope');
const { auth }    = require('../middleware/auth');
const axios       = require('axios');

const BOT_TOKEN    = process.env.BOT_TOKEN    || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';
const ADMIN_TG     = process.env.ADMIN_TG_ID  || '8509393869';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '8435';

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

// ── GET /envelope/list — all active envelopes (user) ──────────────────────────
router.get('/list', auth, async (req, res) => {
  try {
    const now = new Date();
    const envelopes = await Envelope.find({ active: true });
    const userId = req.user._id.toString();

    const result = envelopes.map(e => ({
      _id:        e._id,
      title:      e.title,
      amount:     e.amount,
      expire_at:  e.expire_at,
      expired:    now > e.expire_at,
      claimed:    e.claimed_by.some(c => c.user_id.toString() === userId),
      total_claimed: e.claimed_by.length
    }));

    res.json({ status: 'success', envelopes: result });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── POST /envelope/claim — claim envelope ─────────────────────────────────────
router.post('/claim', auth, async (req, res) => {
  try {
    const { envelope_id } = req.body;
    if (!envelope_id) return res.status(400).json({ status: 'error', message: 'envelope_id required' });

    const envelope = await Envelope.findById(envelope_id);
    if (!envelope || !envelope.active)
      return res.json({ status: 'error', message: 'Envelope nahi mila' });

    if (new Date() > envelope.expire_at)
      return res.json({ status: 'error', message: 'Ye envelope expire ho gaya hai!' });

    const userId = req.user._id.toString();
    if (envelope.claimed_by.some(c => c.user_id.toString() === userId))
      return res.json({ status: 'error', message: 'Aap pehle se claim kar chuke hain!' });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });

    const now  = new Date();
    const txId = 'ENV' + Date.now() + Math.floor(Math.random() * 999);

    await User.findByIdAndUpdate(req.user._id, { $inc: { balance: envelope.amount } });

    await Transaction.create({
      tx_id:       txId,
      receiver_id: req.user._id,
      amount:      envelope.amount,
      type:        'envelope',
      status:      'success',
      remark:      `🧧 ${envelope.title} Envelope`,
      tx_time:     now
    });

    envelope.claimed_by.push({
      user_id:    req.user._id,
      name:       user.name,
      mobile:     user.mobile,
      claimed_at: now
    });
    await envelope.save();

    const updUser = await User.findById(req.user._id).select('balance tg_id');

    if (updUser?.tg_id) {
      sendTG(updUser.tg_id,
`🧧 *Envelope Claimed!*

━━━━━━━━━━━━
⚡  UNIO WALLET ✅
━━━━━━━━━━━━

🎉 ${envelope.title}
💰 Amount : ₹${envelope.amount}
🆔 Txn ID : \`${txId}\`
📅 Date : ${istTime()}

━━━━━━━━━━━━
🪙 Balance : ₹${updUser.balance}
━━━━━━━━━━━━`);
    }

    sendTG(ADMIN_TG,
`🧧 *Envelope Claimed*

🎉 ${envelope.title}
👤 ${user.name} (${user.mobile})
💰 ₹${envelope.amount}
👥 Total Claimed: ${envelope.claimed_by.length}
📅 ${istTime()}`);

    res.json({
      status:  'success',
      amount:  envelope.amount,
      title:   envelope.title,
      tx_id:   txId,
      balance: updUser.balance
    });

  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── ADMIN — Create envelope ───────────────────────────────────────────────────
router.post('/admin/create', adminAuth, async (req, res) => {
  try {
    const { title, amount, expire_hours } = req.body;
    if (!title || !amount || !expire_hours)
      return res.status(400).json({ status: 'error', message: 'title, amount, expire_hours required' });

    const amt = parseFloat(amount);
    const hrs = parseFloat(expire_hours);
    if (isNaN(amt) || amt < 1) return res.status(400).json({ status: 'error', message: 'Valid amount required' });
    if (isNaN(hrs) || hrs < 1) return res.status(400).json({ status: 'error', message: 'Valid expire_hours required' });

    const expire_at = new Date(Date.now() + hrs * 3600 * 1000);
    const envelope  = await Envelope.create({ title, amount: amt, expire_at });

    sendTG(ADMIN_TG,
`🧧 *New Envelope Created*

🎉 Title: ${title}
💰 Amount: ₹${amt} per user
⏰ Expires: ${expire_at.toLocaleString('en-IN', { timeZone:'Asia/Kolkata' })}
📅 ${istTime()}`);

    res.json({ status: 'success', envelope: { _id: envelope._id, title, amount: amt, expire_at } });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── ADMIN — List all envelopes ────────────────────────────────────────────────
router.get('/admin/list', adminAuth, async (req, res) => {
  try {
    const envelopes = await Envelope.find().sort({ created_at: -1 });
    res.json({
      status: 'success',
      envelopes: envelopes.map(e => ({
        _id:           e._id,
        title:         e.title,
        amount:        e.amount,
        expire_at:     e.expire_at,
        active:        e.active,
        expired:       new Date() > e.expire_at,
        total_claimed: e.claimed_by.length,
        claimed_by:    e.claimed_by
      }))
    });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── ADMIN — Delete envelope + transactions ────────────────────────────────────
router.delete('/admin/:id', adminAuth, async (req, res) => {
  try {
    const envelope = await Envelope.findById(req.params.id);
    if (!envelope) return res.json({ status: 'error', message: 'Envelope not found' });

    // Delete related transactions
    const txResult = await Transaction.deleteMany({
      remark: new RegExp(envelope.title)
    });

    await Envelope.findByIdAndDelete(req.params.id);

    res.json({
      status:               'success',
      deleted:              envelope.title,
      transactions_deleted: txResult.deletedCount,
      total_claimed:        envelope.claimed_by.length
    });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── ADMIN — Toggle active ─────────────────────────────────────────────────────
router.patch('/admin/:id/toggle', adminAuth, async (req, res) => {
  try {
    const envelope = await Envelope.findById(req.params.id);
    if (!envelope) return res.json({ status: 'error', message: 'Envelope not found' });
    envelope.active = !envelope.active;
    await envelope.save();
    res.json({ status: 'success', active: envelope.active });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;
