const router = require('express').Router();
const User   = require('../models/User');

function generateRefCode(mobile) {
  const m      = mobile.toString();
  const d0     = m[0]          || '0';
  const d8     = m[m.length-2] || '0';
  const d9     = m[m.length-1] || '0';
  const d3     = m[3]          || '0';
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const letter  = letters[Number(m) % letters.length] || 'X';
  return (d0 + d8 + d9 + d3 + letter).toUpperCase();
}

router.get('/run', async (req, res) => {
  const users = await User.find({ $or: [{ ref_code: '' }, { ref_code: null }, { ref_code: { $exists: false } }] });
  for(const u of users) {
    await User.findByIdAndUpdate(u._id, { ref_code: generateRefCode(u.mobile) });
  }
  res.json({ status: 'success', updated: users.length });
});

module.exports = router;

