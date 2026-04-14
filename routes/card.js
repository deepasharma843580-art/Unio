const router    = require('express').Router();
const bcrypt    = require('bcryptjs');
const User      = require('../models/User');
const Card      = require('../models/Card');
const Transaction = require('../models/Transaction');

// ── Helper: Generate unique card number UW-XXXX-XXXX ─────────────────────────
function generateCardNumber() {
  const part1 = Math.floor(1000 + Math.random() * 9000);
  const part2 = Math.floor(1000 + Math.random() * 9000);
  return `UW-${part1}-${part2}`;
}

async function uniqueCardNumber() {
  let num, exists;
  do {
    num = generateCardNumber();
    exists = await Card.findOne({ card_number: num });
  } while (exists);
  return num;
}

// ── Auth Middleware: validate api_key ─────────────────────────────────────────
async function authUser(req, res, next) {
  const key = req.query.key || req.body.key;
  if (!key) return res.json({ status: 'error', message: 'API key required' });
  const user = await User.findOne({ api_key: key });
  if (!user) return res.json({ status: 'error', message: 'Invalid API key' });
  req.user = user;
  next();
}

// ── POST /card/create — Create card for user ──────────────────────────────────
router.post('/create', authUser, async (req, res) => {
  try {
    const existing = await Card.findOne({ user_id: req.user._id });
    if (existing) return res.json({ status: 'error', message: 'Card already exists for this account' });

    const { pin } = req.body;
    if (!pin || pin.length < 4) return res.json({ status: 'error', message: 'PIN must be at least 4 digits' });

    const hashedPin  = await bcrypt.hash(String(pin), 10);
    const cardNumber = await uniqueCardNumber();

    const card = await Card.create({
      user_id:     req.user._id,
      card_number: cardNumber,
      pin:         hashedPin,
      balance:     0
    });

    res.json({
      status:  'success',
      message: 'Card created successfully',
      data: {
        card_number: card.card_number,
        balance:     card.balance,
        created_at:  card.created_at
      }
    });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── GET /card/info — Get card info ────────────────────────────────────────────
router.get('/info', authUser, async (req, res) => {
  try {
    const card = await Card.findOne({ user_id: req.user._id });
    if (!card) return res.json({ status: 'error', message: 'No card found. Create one first.' });

    res.json({
      status: 'success',
      data: {
        card_number: card.card_number,
        balance:     card.balance,
        is_active:   card.is_active,
        created_at:  card.created_at
      }
    });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── POST /card/set-pin — Change PIN ───────────────────────────────────────────
router.post('/set-pin', authUser, async (req, res) => {
  try {
    const { old_pin, new_pin } = req.body;
    if (!old_pin || !new_pin) return res.json({ status: 'error', message: 'old_pin and new_pin required' });
    if (new_pin.length < 4) return res.json({ status: 'error', message: 'New PIN must be at least 4 digits' });

    const card = await Card.findOne({ user_id: req.user._id });
    if (!card) return res.json({ status: 'error', message: 'Card not found' });

    const match = await bcrypt.compare(String(old_pin), card.pin);
    if (!match) return res.json({ status: 'error', message: 'Incorrect current PIN' });

    card.pin = await bcrypt.hash(String(new_pin), 10);
    await card.save();

    res.json({ status: 'success', message: 'PIN updated successfully' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── POST /card/add-balance — Wallet → Card ────────────────────────────────────
router.post('/add-balance', authUser, async (req, res) => {
  try {
    const { pin, amount } = req.body;
    if (!pin || !amount) return res.json({ status: 'error', message: 'pin and amount required' });

    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(amt) || amt < 1) return res.json({ status: 'error', message: 'Invalid amount. Minimum ₹1' });

    const card = await Card.findOne({ user_id: req.user._id });
    if (!card) return res.json({ status: 'error', message: 'Card not found' });
    if (!card.is_active) return res.json({ status: 'error', message: 'Card is inactive' });

    const match = await bcrypt.compare(String(pin), card.pin);
    if (!match) return res.json({ status: 'error', message: 'Incorrect PIN' });

    if (req.user.balance < amt)
      return res.json({ status: 'error', message: 'Insufficient wallet balance' });

    // Deduct from wallet, add to card
    await User.findByIdAndUpdate(req.user._id, { $inc: { balance: -amt } });
    card.balance += amt;
    await card.save();

    await Transaction.create({
      tx_id:      'UWC' + Math.random().toString(36).substr(2, 6).toUpperCase(),
      sender_id:  req.user._id,
      receiver_id: req.user._id,
      amount:     amt,
      type:       'card_load',
      status:     'success',
      remark:     'Wallet to Card Transfer',
      tx_time:    new Date()
    });

    res.json({
      status:  'success',
      message: `₹${amt} added to card`,
      data: { card_balance: card.balance, wallet_balance: req.user.balance - amt }
    });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── POST /card/withdraw — Card → Wallet ───────────────────────────────────────
router.post('/withdraw', authUser, async (req, res) => {
  try {
    const { pin, amount } = req.body;
    if (!pin || !amount) return res.json({ status: 'error', message: 'pin and amount required' });

    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(amt) || amt < 1) return res.json({ status: 'error', message: 'Invalid amount. Minimum ₹1' });

    const card = await Card.findOne({ user_id: req.user._id });
    if (!card) return res.json({ status: 'error', message: 'Card not found' });
    if (!card.is_active) return res.json({ status: 'error', message: 'Card is inactive' });

    const match = await bcrypt.compare(String(pin), card.pin);
    if (!match) return res.json({ status: 'error', message: 'Incorrect PIN' });

    if (card.balance < amt)
      return res.json({ status: 'error', message: 'Insufficient card balance' });

    // Deduct from card, add to wallet
    card.balance -= amt;
    await card.save();
    await User.findByIdAndUpdate(req.user._id, { $inc: { balance: +amt } });

    await Transaction.create({
      tx_id:      'UWC' + Math.random().toString(36).substr(2, 6).toUpperCase(),
      sender_id:  req.user._id,
      receiver_id: req.user._id,
      amount:     amt,
      type:       'card_withdraw',
      status:     'success',
      remark:     'Card to Wallet Withdrawal',
      tx_time:    new Date()
    });

    const updatedUser = await User.findById(req.user._id).select('balance');
    res.json({
      status:  'success',
      message: `₹${amt} withdrawn to wallet`,
      data: { card_balance: card.balance, wallet_balance: updatedUser.balance }
    });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── GET /card/transactions — Card transaction history ─────────────────────────
router.get('/transactions', authUser, async (req, res) => {
  try {
    const txns = await Transaction.find({
      sender_id: req.user._id,
      type: { $in: ['card_load', 'card_withdraw'] }
    }).sort({ tx_time: -1 }).limit(50);

    res.json({ status: 'success', data: txns });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;
           
