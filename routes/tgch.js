const router = require('express').Router();
const User   = require('../models/User');

// ─── Hardcoded admin password (env se lena best hai) ─────────────────────────
const TGCH_PASS = process.env.TGCH_PASS || '8435';

function checkPass(req, res, next) {
  const pass = req.headers['x-tgch-pass'] || req.body?.password;
  if (pass !== TGCH_PASS)
    return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  next();
}

// POST /admin/tgch-auth — password verify karo
router.post('/tgch-auth', (req, res) => {
  const { password } = req.body;
  if (password === TGCH_PASS)
    res.json({ status: 'success' });
  else
    res.status(401).json({ status: 'error', message: 'Wrong password' });
});

// GET /admin/tgch-user/:mobile — user details fetch karo
router.get('/tgch-user/:mobile', checkPass, async (req, res) => {
  try {
    const user = await User.findOne({ mobile: req.params.mobile })
      .select('name mobile balance wallet_id tg_id status created_at');
    if (!user)
      return res.status(404).json({ status: 'error', message: 'User not found' });
    res.json({ status: 'success', user });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// POST /admin/tgch-update — tg_id update karo
router.post('/tgch-update', checkPass, async (req, res) => {
  try {
    const { mobile, tg_id } = req.body;
    if (!mobile || !tg_id)
      return res.status(400).json({ status: 'error', message: 'Mobile aur TG ID required' });

    const user = await User.findOneAndUpdate(
      { mobile },
      { $set: { tg_id: tg_id.toString() } },
      { new: true }
    );
    if (!user)
      return res.status(404).json({ status: 'error', message: 'User not found' });

    res.json({ status: 'success', message: 'TG ID updated!', tg_id: user.tg_id });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;

