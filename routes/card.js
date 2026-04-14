// routes/card.js
// ─────────────────────────────────────────────────────────────────
//  UNIO Card System
//  - Dashboard se auto card generate (token auth)
//  - Card se payment (number + amount + remark)
//  - TG instant alerts
//  - Receipt data
// ─────────────────────────────────────────────────────────────────

const router      = require('express').Router();
const bcrypt      = require('bcryptjs');
const User        = require('../models/User');
const Card        = require('../models/Card');
const Transaction = require('../models/Transaction');
const { auth }    = require('../middleware/auth');
const axios       = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';

// ── Helpers ───────────────────────────────────────────────────────────────────
async function sendTG(chat_id, text) {
  if (!chat_id) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      { chat_id, text, parse_mode: 'Markdown' }, { timeout: 8000 });
  } catch(e) {}
}

function istTime() {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
    year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  });
}

// Generate unique card number: UW-XXXX-XXX (7 digits)
async function generateCardNumber() {
  let num, exists;
  do {
    const p1 = Math.floor(1000 + Math.random() * 9000); // 4 digits
    const p2 = Math.floor(100  + Math.random() * 900);  // 3 digits
    num = `UW-${p1}-${p2}`;
    exists = await Card.findOne({ card_number: num });
  } while (exists);
  return num;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /card/me — get or auto-create card (dashboard auth via JWT)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('name mobile balance');
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });

    let card = await Card.findOne({ user_id: req.user._id });

    if (!card) {
      // Auto-create with default PIN (user will set their own PIN later)
      const cardNumber = await generateCardNumber();
      const defaultPin = await bcrypt.hash('0000', 10);
      card = await Card.create({
        user_id:     req.user._id,
        card_number: cardNumber,
        pin:         defaultPin,
        balance:     0
      });
    }

    res.json({
      status: 'success',
      data: {
        card_number: card.card_number,
        balance:     card.balance,
        is_active:   card.is_active,
        created_at:  card.created_at,
        holder_name: user.name,
        mobile:      user.mobile,
        wallet_balance: user.balance,
        pin_set:     false  // Default PIN 0000, user should change
      }
    });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /card/set-pin — set/change card PIN (JWT auth)
// Body: { new_pin, old_pin? }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/set-pin', auth, async (req, res) => {
  try {
    const { new_pin, old_pin } = req.body;
    if (!new_pin || String(new_pin).length < 4)
      return res.status(400).json({ status: 'error', message: 'PIN must be 4+ digits' });

    const card = await Card.findOne({ user_id: req.user._id });
    if (!card) return res.json({ status: 'error', message: 'Card not found' });

    // If old_pin provided, verify it first
    if (old_pin) {
      const match = await bcrypt.compare(String(old_pin), card.pin);
      if (!match) return res.json({ status: 'error', message: 'Wrong current PIN' });
    }

    card.pin = await bcrypt.hash(String(new_pin), 10);
    await card.save();
    res.json({ status: 'success', message: 'Card PIN set successfully' });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /card/load — Wallet → Card
// Body: { pin, amount }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/load', auth, async (req, res) => {
  try {
    const { pin, amount } = req.body;
    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(amt) || amt < 1) return res.status(400).json({ status: 'error', message: 'Minimum ₹1' });

    const card = await Card.findOne({ user_id: req.user._id });
    if (!card) return res.json({ status: 'error', message: 'Card not found' });
    if (!card.is_active) return res.json({ status: 'error', message: 'Card inactive hai' });

    const match = await bcrypt.compare(String(pin), card.pin);
    if (!match) return res.json({ status: 'error', message: 'Wrong card PIN' });

    const user = await User.findById(req.user._id);
    if (user.balance < amt) return res.json({ status: 'error', message: `Insufficient wallet balance. Available: ₹${user.balance}` });

    await User.findByIdAndUpdate(req.user._id, { $inc: { balance: -amt } });
    card.balance += amt;
    await card.save();

    const txId = 'CL' + Date.now() + Math.floor(Math.random() * 999);
    await Transaction.create({
      tx_id:       txId,
      sender_id:   req.user._id,
      receiver_id: req.user._id,
      amount:      amt,
      type:        'card_load',
      status:      'success',
      remark:      `💳 Card Load`,
      tx_time:     new Date()
    });

    if (user.tg_id) {
      sendTG(user.tg_id,
`💳 *Card Loaded*

━━━━━━━━━━━━
⚡  UNIO CARD ✅
━━━━━━━━━━━━

💰 Amount : ₹${amt}
💳 Card : ${card.card_number}
🆔 Txn ID : \`${txId}\`
📅 Date : ${istTime()}

━━━━━━━━━━━━
🪙 Card Balance : ₹${card.balance}
🏦 Wallet : ₹${user.balance - amt}
━━━━━━━━━━━━`);
    }

    res.json({
      status:  'success',
      message: `₹${amt} card mein add ho gaya!`,
      data:    { card_balance: card.balance, wallet_balance: user.balance - amt, tx_id: txId }
    });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /card/withdraw — Card → Wallet
// Body: { pin, amount }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/withdraw', auth, async (req, res) => {
  try {
    const { pin, amount } = req.body;
    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(amt) || amt < 1) return res.status(400).json({ status: 'error', message: 'Minimum ₹1' });

    const card = await Card.findOne({ user_id: req.user._id });
    if (!card) return res.json({ status: 'error', message: 'Card not found' });
    if (!card.is_active) return res.json({ status: 'error', message: 'Card inactive hai' });

    const match = await bcrypt.compare(String(pin), card.pin);
    if (!match) return res.json({ status: 'error', message: 'Wrong card PIN' });

    if (card.balance < amt) return res.json({ status: 'error', message: `Card mein sirf ₹${card.balance} hai` });

    card.balance -= amt;
    await card.save();
    await User.findByIdAndUpdate(req.user._id, { $inc: { balance: amt } });

    const txId    = 'CW' + Date.now() + Math.floor(Math.random() * 999);
    const updUser = await User.findById(req.user._id).select('balance tg_id');

    await Transaction.create({
      tx_id:       txId,
      sender_id:   req.user._id,
      receiver_id: req.user._id,
      amount:      amt,
      type:        'card_withdraw',
      status:      'success',
      remark:      `💳 Card Withdrawal`,
      tx_time:     new Date()
    });

    if (updUser?.tg_id) {
      sendTG(updUser.tg_id,
`💳 *Card Withdrawal*

━━━━━━━━━━━━
⚡  UNIO CARD ✅
━━━━━━━━━━━━

💰 Amount : ₹${amt}
💳 Card : ${card.card_number}
🆔 Txn ID : \`${txId}\`
📅 Date : ${istTime()}

━━━━━━━━━━━━
🪙 Card Balance : ₹${card.balance}
🏦 Wallet : ₹${updUser.balance}
━━━━━━━━━━━━`);
    }

    res.json({
      status:  'success',
      message: `₹${amt} wallet mein wapas!`,
      data:    { card_balance: card.balance, wallet_balance: updUser.balance, tx_id: txId }
    });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /card/pay — Card se kisi ko pay karo
// Body: { pin, to_mobile, amount, remark? }
// Auto name fetch from mobile, TG to both, receipt response
// ─────────────────────────────────────────────────────────────────────────────
router.post('/pay', auth, async (req, res) => {
  try {
    const { pin, to_mobile, amount, remark } = req.body;
    if (!pin || !to_mobile || !amount)
      return res.status(400).json({ status: 'error', message: 'pin, to_mobile, amount required' });

    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(amt) || amt < 1) return res.status(400).json({ status: 'error', message: 'Minimum ₹1' });

    const senderCard = await Card.findOne({ user_id: req.user._id });
    if (!senderCard) return res.json({ status: 'error', message: 'Aapka card nahi mila' });
    if (!senderCard.is_active) return res.json({ status: 'error', message: 'Aapka card inactive hai' });

    const match = await bcrypt.compare(String(pin), senderCard.pin);
    if (!match) return res.json({ status: 'error', message: 'Wrong card PIN' });

    if (senderCard.balance < amt)
      return res.json({ status: 'error', message: `Card mein sirf ₹${senderCard.balance} hai` });

    // Receiver find
    const receiver = await User.findOne({ mobile: to_mobile.toString() });
    if (!receiver) return res.json({ status: 'error', message: `Mobile ${to_mobile} UNIO pe registered nahi hai` });

    const sender = await User.findById(req.user._id).select('name mobile tg_id');
    if (sender._id.toString() === receiver._id.toString())
      return res.json({ status: 'error', message: 'Apne aap ko pay nahi kar sakte' });

    const txId  = 'CP' + Date.now() + Math.floor(Math.random() * 999);
    const now   = new Date();
    const note  = remark || 'Payment through UNIO Card';

    // Deduct from card, add to receiver wallet
    senderCard.balance -= amt;
    await senderCard.save();
    await User.findByIdAndUpdate(receiver._id, { $inc: { balance: amt } });

    await Transaction.create({
      tx_id:       txId,
      sender_id:   sender._id,
      receiver_id: receiver._id,
      amount:      amt,
      type:        'card_pay',
      status:      'success',
      remark:      `💳 ${note}`,
      tx_time:     now
    });

    const dt = istTime();

    // TG to sender
    if (sender.tg_id) {
      sendTG(sender.tg_id,
`💳 *Card Payment Sent*

━━━━━━━━━━━━
⚡  UNIO CARD ✅
━━━━━━━━━━━━

💰 Amount : ₹${amt}
👤 To : ${receiver.name} (\`${to_mobile}\`)
💳 Card : ${senderCard.card_number}
💬 Remark : ${note}
🆔 Txn ID : \`${txId}\`
📅 Date : ${dt}

━━━━━━━━━━━━
🪙 Card Balance : ₹${senderCard.balance}
━━━━━━━━━━━━`);
    }

    // TG to receiver
    const recvUpdated = await User.findById(receiver._id).select('balance tg_id');
    if (recvUpdated?.tg_id) {
      sendTG(recvUpdated.tg_id,
`💳 *Card Payment Received*

━━━━━━━━━━━━
⚡  UNIO CARD ✅
━━━━━━━━━━━━

💰 Amount : ₹${amt}
👤 From : ${sender.name} (\`${sender.mobile}\`)
💬 Remark : ${note}
🆔 Txn ID : \`${txId}\`
📅 Date : ${dt}

━━━━━━━━━━━━
🪙 Wallet : ₹${recvUpdated.balance}
━━━━━━━━━━━━`);
    }

    // Receipt response
    res.json({
      status:  'success',
      message: 'Payment successful!',
      receipt: {
        tx_id:         txId,
        amount:        amt,
        sender_name:   sender.name,
        sender_card:   senderCard.card_number,
        receiver_name: receiver.name,
        receiver_mobile: to_mobile,
        remark:        note,
        timestamp:     dt,
        card_balance:  senderCard.balance
      }
    });

  } catch(e) {
    console.error('Card pay error:', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /card/lookup/:mobile — fetch receiver name
// ─────────────────────────────────────────────────────────────────────────────
router.get('/lookup/:mobile', auth, async (req, res) => {
  try {
    const user = await User.findOne({ mobile: req.params.mobile }).select('name mobile');
    if (!user) return res.json({ status: 'error', message: 'User not found' });
    res.json({ status: 'success', name: user.name, mobile: user.mobile });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /card/transactions — history
// ─────────────────────────────────────────────────────────────────────────────
router.get('/transactions', auth, async (req, res) => {
  try {
    const txns = await Transaction.find({
      $or: [{ sender_id: req.user._id }, { receiver_id: req.user._id }],
      type: { $in: ['card_load', 'card_withdraw', 'card_pay'] }
    }).sort({ tx_time: -1 }).limit(50);
    res.json({ status: 'success', data: txns });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;
              
