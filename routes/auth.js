const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const User   = require('../models/User');
const { auth } = require('../middleware/auth');

router.post('/register', async (req, res) => {
  try {
    const { name, mobile, password, pin } = req.body;
    if(!mobile || !password) return res.status(400).json({ status:'error', message:'Mobile and password required' });
    if(await User.findOne({ mobile })) return res.status(400).json({ status:'error', message:'Mobile already registered' });
    const user  = await User.create({ name: name||'User', mobile, password, login_pin: pin||'' });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ status:'success', token, user: { id:user._id, name:user.name, mobile:user.mobile, wallet_id:user.wallet_id, balance:user.balance, api_key:user.api_key } });
  } catch(e) { res.status(500).json({ status:'error', message: e.message }); }
});

router.post('/login', async (req, res) => {
  try {
    const { mobile, password } = req.body;
    const user = await User.findOne({ mobile });
    if(!user || !(await user.matchPassword(password)))
      return res.status(401).json({ status:'error', message:'Invalid mobile or password' });
    if(user.is_banned === 1) return res.status(403).json({ status:'error', message:'Account permanently banned' });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ status:'success', token, user: { id:user._id, name:user.name, mobile:user.mobile, wallet_id:user.wallet_id, balance:user.balance, tg_id:user.tg_id, api_key:user.api_key } });
  } catch(e) { res.status(500).json({ status:'error', message: e.message }); }
});

router.get('/me', auth, (req, res) => res.json({ status:'success', user: req.user }));

router.post('/update-tg', auth, async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { tg_id: req.body.tg_id });
  res.json({ status:'success', message:'Telegram linked' });
});

router.post('/regen-key', auth, async (req, res) => {
  const { v4: uuidv4 } = require('uuid');
  const key = 'UW-' + uuidv4().replace(/-/g,'').slice(0,20);
  await User.findByIdAndUpdate(req.user._id, { api_key: key });
  res.json({ status:'success', api_key: key });
});

module.exports = router;
