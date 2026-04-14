const router      = require('express').Router();
const Card        = require('../models/Card');
const Transaction = require('../models/Transaction');
const User        = require('../models/User');

const ADMIN_PASSWORD = process.env.CARD_ADMIN_PASS || '8435';

// ── Admin Auth Middleware ─────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const pass = req.query.pass || req.body.pass || req.headers['x-admin-pass'];
  if (pass !== ADMIN_PASSWORD)
    return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  next();
}

// ── GET /card-admin/cards — All cards with user info ─────────────────────────
router.get('/cards', adminAuth, async (req, res) => {
  try {
    const cards = await Card.find().populate('user_id', 'name mobile email balance').sort({ created_at: -1 });
    res.json({ status: 'success', data: cards });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── GET /card-admin/transactions — All card transactions ─────────────────────
router.get('/transactions', adminAuth, async (req, res) => {
  try {
    const txns = await Transaction.find({
      type: { $in: ['card_load', 'card_withdraw'] }
    })
    .populate('sender_id', 'name mobile')
    .sort({ tx_time: -1 })
    .limit(200);
    res.json({ status: 'success', data: txns });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── DELETE /card-admin/clear-weekly — Delete card txns older than 7 days ─────
router.delete('/clear-weekly', adminAuth, async (req, res) => {
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await Transaction.deleteMany({
      type: { $in: ['card_load', 'card_withdraw'] },
      tx_time: { $lt: oneWeekAgo }
    });
    res.json({
      status: 'success',
      message: `Deleted ${result.deletedCount} card transactions older than 7 days`
    });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── DELETE /card-admin/clear-all — Delete ALL card transactions ───────────────
router.delete('/clear-all', adminAuth, async (req, res) => {
  try {
    const result = await Transaction.deleteMany({
      type: { $in: ['card_load', 'card_withdraw'] }
    });
    res.json({
      status: 'success',
      message: `Deleted all ${result.deletedCount} card transactions`
    });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── PATCH /card-admin/toggle/:cardId — Activate / Deactivate card ─────────────
router.patch('/toggle/:cardId', adminAuth, async (req, res) => {
  try {
    const card = await Card.findById(req.params.cardId);
    if (!card) return res.json({ status: 'error', message: 'Card not found' });
    card.is_active = !card.is_active;
    await card.save();
    res.json({
      status:  'success',
      message: `Card ${card.is_active ? 'activated' : 'deactivated'}`,
      is_active: card.is_active
    });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── GET /card-admin/stats — Summary stats ────────────────────────────────────
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const totalCards   = await Card.countDocuments();
    const activeCards  = await Card.countDocuments({ is_active: true });
    const totalLoaded  = await Transaction.aggregate([
      { $match: { type: 'card_load' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalWithdrawn = await Transaction.aggregate([
      { $match: { type: 'card_withdraw' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    res.json({
      status: 'success',
      data: {
        total_cards:    totalCards,
        active_cards:   activeCards,
        inactive_cards: totalCards - activeCards,
        total_loaded:   totalLoaded[0]?.total || 0,
        total_withdrawn: totalWithdrawn[0]?.total || 0
      }
    });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;
      
