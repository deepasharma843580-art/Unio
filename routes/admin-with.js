// routes/admin-with.js
// GET    /todaywithdraws     → aaj ki withdrawals
// GET    /weeklywithdrawals  → is hafte ki withdrawals
// DELETE /deletewithdrawals  → scope: "week" | "all"
// Header: x-admin-pass: 8435

const router      = require('express').Router();
const Transaction = require('../models/Transaction');

const ADMIN_PASS = '8435';

function adminAuth(req, res, next) {
  const pass = req.headers['x-admin-pass'] || req.query.admin_pass;
  if (pass !== ADMIN_PASS)
    return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  next();
}

// ── Mask mobile: 9876543210 → 9876xx10 ───────────────────────────────────────
function maskMobile(mobile) {
  if (!mobile) return 'xxxxxxxxxx';
  const s = mobile.toString().trim();
  if (s.length <= 4) return 'x'.repeat(s.length);
  const start = s.slice(0, 4);
  const end   = s.slice(-2);
  const mid   = 'x'.repeat(s.length - 6);
  return start + mid + end;
}

// ── Mask UPI: rahul123@okaxis → rah***@okaxis ────────────────────────────────
function maskUPI(upi) {
  if (!upi) return null;
  const s = upi.toString().trim();
  const atIdx = s.indexOf('@');
  if (atIdx === -1) {
    if (s.length <= 4) return s[0] + '***';
    return s.slice(0, 3) + '***' + s.slice(-2);
  }
  const handle = s.slice(0, atIdx);
  const bank   = s.slice(atIdx);
  if (handle.length <= 3) return handle[0] + '***' + bank;
  return handle.slice(0, 3) + '***' + bank;
}

// ── Build list + summary ──────────────────────────────────────────────────────
function buildResponse(withdrawals) {
  let totalAmount = 0, countPending = 0, countSuccess = 0, countFailed = 0;

  const list = withdrawals.map(t => {
    const status = (t.status || 'pending').toLowerCase();

    if (status === 'pending')                              countPending++;
    else if (status === 'success')                         countSuccess++;
    else if (status === 'failed' || status === 'rejected') countFailed++;
    if (status === 'success') totalAmount += (t.amount || 0);

    const user   = t.sender_id || {};
    const mobile = user.mobile || null;
    const upi    = user.upi_id || t.upi_id || t.remark?.match(/[\w.\-]+@[\w]+/)?.[0] || null;

    return {
      tx_id:         t._id,
      name:          user.name || 'Unknown',
      mobile_masked: maskMobile(mobile),
      upi_masked:    maskUPI(upi),
      amount:        t.amount || 0,
      status,
      remark:        t.remark || null,
      time:          t.tx_time
    };
  });

  return {
    summary: {
      total_requests:       list.length,
      total_success_amount: totalAmount,
      pending:              countPending,
      success:              countSuccess,
      rejected:             countFailed
    },
    pending:  list.filter(t => t.status === 'pending'),
    success:  list.filter(t => t.status === 'success'),
    rejected: list.filter(t => t.status === 'failed' || t.status === 'rejected')
  };
}

// ── GET /todaywithdraws ───────────────────────────────────────────────────────
router.get('/todaywithdraws', adminAuth, async (req, res) => {
  try {
    const now        = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(),  0,  0,  0,   0);
    const endOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const withdrawals = await Transaction.find({
      type:    { $in: ['withdrawal', 'withdraw'] },
      tx_time: { $gte: startOfDay, $lte: endOfDay }
    })
    .populate('sender_id', 'name mobile upi_id')
    .sort({ tx_time: -1 });

    const { summary, pending, success, rejected } = buildResponse(withdrawals);

    return res.json({
      status: 'success',
      date:   now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      summary, pending, success, rejected
    });

  } catch (e) {
    console.error('[todaywithdraws]', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── GET /weeklywithdrawals ────────────────────────────────────────────────────
router.get('/weeklywithdrawals', adminAuth, async (req, res) => {
  try {
    const now         = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 6);
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const withdrawals = await Transaction.find({
      type:    { $in: ['withdrawal', 'withdraw'] },
      tx_time: { $gte: startOfWeek, $lte: endOfToday }
    })
    .populate('sender_id', 'name mobile upi_id')
    .sort({ tx_time: -1 });

    const { summary, pending, success, rejected } = buildResponse(withdrawals);

    return res.json({
      status: 'success',
      week: `${startOfWeek.toLocaleDateString('en-IN', { day:'2-digit', month:'short' })} – ${now.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}`,
      summary, pending, success, rejected
    });

  } catch (e) {
    console.error('[weeklywithdrawals]', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── DELETE /deletewithdrawals ─────────────────────────────────────────────────
// Body or query: { scope: "week" | "all" }
router.delete('/deletewithdrawals', adminAuth, async (req, res) => {
  try {
    const scope  = (req.body?.scope || req.query?.scope || 'week').toLowerCase();
    let   filter = { type: { $in: ['withdrawal', 'withdraw'] } };

    if (scope === 'week') {
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - 6);
      startOfWeek.setHours(0, 0, 0, 0);
      filter.tx_time = { $gte: startOfWeek };
    }
    // scope=all → no date filter

    const result = await Transaction.deleteMany(filter);

    return res.json({
      status:  'success',
      scope,
      deleted: result.deletedCount,
      message: `${result.deletedCount} withdrawal transaction(s) deleted (scope: ${scope})`
    });

  } catch (e) {
    console.error('[deletewithdrawals]', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;
