const router   = require('express').Router();
const mongoose = require('mongoose');
const jwt      = require('jsonwebtoken');
const User     = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'unio_secret_2026';

// ── Register ──────────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    console.log('DB State:', mongoose.connection.readyState);
    console.log('Register attempt:', req.body?.mobile);

    const { name, mobile, password, pin } = req.body;
    if(!name || !mobile || !password || !pin)
      return res.status(400).json({ status:'error', message:'All fields required' });

    const exists = await User.findOne({ mobile });
    if(exists) return res.status(400).json({ status:'error', message:'Mobile already registered' });

    const wallet_id = 'UW' + Date.now().toString().slice(-6);
    const api_key   = 'UW-' + Math.random().toString(36).substr(2,12).toUpperCase();

    const user = await User.create({ name, mobile, password, pin, wallet_id, api_key, balance: 0 });
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      status: 'success',
      token,
      user: {
        id:        user._id,
        name:      user.name,
        mobile:    user.mobile,
        wallet_id: user.wallet_id,
        api_key:   user.api_key,
        balance:   user.balance,
        tg_id:     user.tg_id || ''
      }
    });
  } catch(e) {
    console.error('Register error:', e.message);
    res.status(500).json({ status:'error', message: e.message });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    console.log('DB State:', mongoose.connection.readyState);
    console.log('Login attempt:', req.body?.mobile);

    const { mobile, password } = req.body;
    if(!mobile || !password)
      return res.status(400).json({ status:'error', message:'Mobile and password required' });

    const user = await User.findOne({ mobile });
    if(!user) return res.status(404).json({ status:'error', message:'User not found' });

    const match = await user.matchPassword(password);
    if(!match) return res.status(401).json({ status:'error', message:'Invalid password' });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      status: 'success',
      token,
      user: {
        id:        user._id,
        name:      user.name,
        mobile:    user.mobile,
        wallet_id: user.wallet_id,
        api_key:   user.api_key,
        balance:   user.balance,
        tg_id:     user.tg_id || ''
      }
    });
  } catch(e) {
    console.error('Login error:', e.message);
    res.status(500).json({ status:'error', message: e.message });
  }
});

// ── Update Telegram ID ────────────────────────────────────────────────────────
router.post('/update-tg', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if(!token) return res.status(401).json({ status:'error', message:'No token' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const { tg_id } = req.body;

    // Duplicate check
    if(tg_id) {
      const existing = await User.findOne({ tg_id, _id: { $ne: decoded.id } });
      if(existing) return res.json({
        status:  'error',
        message: 'Ye Telegram ID pehle se kisi aur account mein linked hai!'
      });
    }

    await User.findByIdAndUpdate(decoded.id, { tg_id: tg_id || '' });
    res.json({ status:'success', message:'Telegram ID updated' });
  } catch(e) {
    res.status(500).json({ status:'error', message: e.message });
  }
});

// ── Update TG by Mobile (claim page) ─────────────────────────────────────────
router.post('/update-tg-by-mobile', async (req, res) => {
  try {
    const { mobile, tg_id } = req.body;
    if(!mobile || !tg_id) return res.status(400).json({ status:'error', message:'mobile and tg_id required' });

    // Duplicate check
    if(tg_id) {
      const existing = await User.findOne({ tg_id, mobile: { $ne: mobile } });
      if(existing) return res.json({
        status:  'error',
        message: 'Ye Telegram ID pehle se kisi aur account mein linked hai!'
      });
    }

    await User.findOneAndUpdate({ mobile }, { tg_id });
    res.json({ status:'success', message:'Telegram ID updated' });
  } catch(e) {
    res.status(500).json({ status:'error', message: e.message });
  }
});

// ── Check Mobile (claim page) ─────────────────────────────────────────────────
router.post('/check-mobile', async (req, res) => {
  try {
    const { mobile } = req.body;
    if(!mobile) return res.status(400).json({ status:'error', message:'Mobile required' });
    const user = await User.findOne({ mobile }).select('name mobile tg_id');
    if(!user) return res.json({ status:'error', message:'User not found' });
    res.json({ status:'success', name: user.name, mobile: user.mobile, tg_id: user.tg_id || '' });
  } catch(e) {
    res.status(500).json({ status:'error', message: e.message });
  }
});

// ── Regen API Key ─────────────────────────────────────────────────────────────
router.post('/regen-key', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if(!token) return res.status(401).json({ status:'error', message:'No token' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const api_key = 'UW-' + Math.random().toString(36).substr(2,12).toUpperCase();

    await User.findByIdAndUpdate(decoded.id, { api_key });
    res.json({ status:'success', api_key });
  } catch(e) {
    res.status(500).json({ status:'error', message: e.message });
  }
});

// ── Test Route ────────────────────────────────────────────────────────────────
router.get('/test', async (req, res) => {
  try {
    const state = mongoose.connection.readyState;
    const states = { 0:'disconnected', 1:'connected', 2:'connecting', 3:'disconnecting' };
    res.json({
      status:        'success',
      db_state:      states[state] || 'unknown',
      db_state_code: state,
      mongo_uri_set: !!process.env.MONGO_URI,
      time:          new Date().toISOString()
    });
  } catch(e) {
    res.status(500).json({ status:'error', message: e.message });
  }
});

module.exports = router;
    
