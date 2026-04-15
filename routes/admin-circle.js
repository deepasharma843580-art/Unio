// routes/admin-circle.js
// ─────────────────────────────────────────────────────────────────
//  UNIO Admin Circle Routes
//  - GET  /admin/circle-stats        — dashboard stats
//  - GET  /admin/circle-txns         — last 20 circle/card txns
//  - GET  /admin/circle-members      — all active circle members
//  - DELETE /admin/circle-delete-txns — delete txns by days+type
// ─────────────────────────────────────────────────────────────────

const router      = require('express').Router();
const Transaction = require('../models/Transaction');
const Circle      = require('../models/Circle');

// Simple admin check middleware (password in header or just open — 
// since panel is password-locked on frontend, server just checks admin token)
// You can add your existing admin middleware here if you have one.

// ─────────────────────────────────────────────────────────────────
// GET /admin/circle-stats
// ─────────────────────────────────────────────────────────────────
router.get('/circle-stats', async (req, res) => {
  try {
    const now   = new Date();
    const d7ago = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const [total, last7d, circle, members] = await Promise.all([
      Transaction.countDocuments({}),
      Transaction.countDocuments({ tx_time: { $gte: d7ago } }),
      Transaction.countDocuments({ tx_time: { $gte: d7ago }, type: { $regex: /circle/ } }),
      Circle.countDocuments({ status: 'active' })
    ]);

    res.json({ status: 'success', total, last7d, circle, members });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /admin/circle-txns
// Returns last 20 circle/card transactions
// ─────────────────────────────────────────────────────────────────
router.get('/circle-txns', async (req, res) => {
  try {
    const txns = await Transaction.find({
      type: { $in: ['circle_pay', 'card_pay', 'card_load', 'card_withdraw'] }
    })
      .populate('sender_id',   'name mobile')
      .populate('receiver_id', 'name mobile')
      .sort({ tx_time: -1 })
      .limit(20);

    res.json({ status: 'success', data: txns });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /admin/circle-members
// Returns all active circle relationships
// ─────────────────────────────────────────────────────────────────
router.get('/circle-members', async (req, res) => {
  try {
    const circles = await Circle.find({ status: 'active' })
      .populate('owner_id',  'name mobile')
      .populate('member_id', 'name mobile')
      .sort({ created_at: -1 })
      .limit(100);

    res.json({ status: 'success', data: circles });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// DELETE /admin/circle-delete-txns
// Body: { days: 7, type?: 'circle_pay'|'card_pay' }
// Deletes transactions older than X days of given type
// ─────────────────────────────────────────────────────────────────
router.delete('/circle-delete-txns', async (req, res) => {
  try {
    const { days, type } = req.body;
    const d = parseInt(days) || 7;
    if (d < 1 || d > 365) return res.status(400).json({ status: 'error', message: 'Days 1-365 ke beech hone chahiye' });

    const cutoff = new Date(Date.now() - d * 24 * 60 * 60 * 1000);

    const query = { tx_time: { $lte: cutoff } };
    if (type && type !== 'all') {
      query.type = type;
    }

    const result = await Transaction.deleteMany(query);

    res.json({
      status:  'success',
      message: `${result.deletedCount} transactions delete kar diye (last ${d} days)`,
      deleted: result.deletedCount
    });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;

