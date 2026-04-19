// routes/tgch.js
// Tool: Lookup user by mobile & update tg_id
// Admin password: 8435

const router  = require('express').Router();
const User    = require('../models/User');

const ADMIN_PASS = '8435';

function adminAuth(req, res, next) {
  const pass = req.headers['x-admin-pass'] || req.body?.admin_pass || req.query?.admin_pass;
  if (pass !== ADMIN_PASS)
    return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  next();
}

// ── GET /tgch/lookup?mobile=9XXXXXXXXX  ───────────────────────────────────────
// Returns full user info by mobile number
router.get('/lookup', adminAuth, async (req, res) => {
  try {
    const { mobile } = req.query;
    if (!mobile)
      return res.status(400).json({ status: 'error', message: 'mobile query param required' });

    const user = await User.findOne({ mobile: mobile.trim() }).select('-password -otp -otp_expiry');
    if (!user)
      return res.status(404).json({ status: 'error', message: 'No user found with this mobile number' });

    return res.json({ status: 'success', user });

  } catch (e) {
    console.error('[tgch/lookup]', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── POST /tgch/update-tg  ─────────────────────────────────────────────────────
// Body: { mobile, tg_id }
// Updates tg_id for the user with given mobile number
router.post('/update-tg', adminAuth, async (req, res) => {
  try {
    const { mobile, tg_id } = req.body;

    if (!mobile || !tg_id)
      return res.status(400).json({ status: 'error', message: 'mobile and tg_id are required' });

    const user = await User.findOne({ mobile: mobile.trim() });
    if (!user)
      return res.status(404).json({ status: 'error', message: 'No user found with this mobile number' });

    const old_tg = user.tg_id || null;
    user.tg_id = tg_id.toString().trim();
    await user.save();

    return res.json({
      status:  'success',
      message: `Telegram ID updated successfully`,
      mobile:  user.mobile,
      name:    user.name,
      old_tg_id: old_tg,
      new_tg_id: user.tg_id
    });

  } catch (e) {
    console.error('[tgch/update-tg]', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── POST /tgch/clear-tg  ──────────────────────────────────────────────────────
// Body: { mobile }
// Removes tg_id from user (set to null)
router.post('/clear-tg', adminAuth, async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile)
      return res.status(400).json({ status: 'error', message: 'mobile required' });

    const user = await User.findOne({ mobile: mobile.trim() });
    if (!user)
      return res.status(404).json({ status: 'error', message: 'No user found with this mobile number' });

    user.tg_id = null;
    await user.save();

    return res.json({
      status:  'success',
      message: `Telegram ID cleared for ${user.name}`,
      mobile:  user.mobile
    });

  } catch (e) {
    console.error('[tgch/clear-tg]', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;
