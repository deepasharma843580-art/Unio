const jwt  = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if(!token) return res.status(401).json({ status:'error', message:'No token provided' });
  try {
    const dec = jwt.verify(token, process.env.JWT_SECRET);
    req.user  = await User.findById(dec.id).select('-password -login_pin');
    if(!req.user) return res.status(401).json({ status:'error', message:'User not found' });
    if(req.user.is_banned === 1) return res.status(403).json({ status:'error', message:'Account permanently banned' });
    if(req.user.is_banned === 2 && req.user.ban_until && new Date() < new Date(req.user.ban_until))
      return res.status(403).json({ status:'error', message:'Account temporarily banned', until: req.user.ban_until });
    next();
  } catch(e) {
    return res.status(401).json({ status:'error', message:'Invalid token' });
  }
};

const adminAuth = async (req, res, next) => {
  await auth(req, res, () => {
    if(!req.user.is_admin) return res.status(403).json({ status:'error', message:'Admin access required' });
    next();
  });
};

const apiKeyAuth = async (req, res, next) => {
  const key = req.query.key || req.headers['x-api-key'];
  if(!key) return res.status(401).json({ status:'error', message:'API key required. Use ?key=YOUR_KEY' });
  const user = await User.findOne({ api_key: key, status: 'active' });
  if(!user) return res.status(401).json({ status:'error', message:'Invalid API key' });
  req.apiUser = user;
  next();
};

module.exports = { auth, adminAuth, apiKeyAuth };
