const router   = require('express').Router();
const mongoose = require('mongoose');
const jwt      = require('jsonwebtoken');
const User     = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'unio_secret_2026';
const BOT_TOKEN  = process.env.BOT_TOKEN  || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';
const ADMIN_TG   = '8509393869';

// OTP store (in-memory, resets on server restart)
const otpStore     = {};  // for register
const pinOtpStore  = {};  // for forgot-pin

// ── Send Telegram Message ─────────────────────────────────────────────────────
async function sendTG(chat_id, text) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id, text, parse_mode: 'HTML' })
    });
  } catch(e) { console.error('TG send error:', e.message); }
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function auth(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ status: 'error', message: 'No token' });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch(e) {
    res.status(401).json({ status: 'error', message: 'Invalid token' });
  }
}

// ── Send OTP (Register) ───────────────────────────────────────────────────────
router.post('/send-otp', async (req, res) => {
  try {
    const { tg_id, name } = req.body;
    if (!tg_id) return res.status(400).json({ status: 'error', message: 'Telegram ID required' });

    const existing = await User.findOne({ tg_id });
    if (existing) return res.status(400).json({ status: 'error', message: 'Ye Telegram ID pehle se registered hai!' });

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    otpStore[tg_id] = { otp, expires: Date.now() + 5 * 60 * 1000 };

    await sendTG(tg_id,
      `👋 <b>Welcome to UNIO Wallet!</b>\n\n` +
      `🔐 <b>OTP = ${otp}</b>\n\n` +
      `This is your registration OTP code.\n` +
      `Valid for 5 minutes.\n\n` +
      `Thanks for joining UNIO ❤️`
    );

    res.json({ status: 'success', message: 'OTP sent!' });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Register ──────────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    console.log('DB State:', mongoose.connection.readyState);
    console.log('Register attempt:', req.body?.mobile);

    const { name, mobile, password, pin, tg_id, otp } = req.body;
    if (!name || !mobile || !password || !tg_id || !otp)
      return res.status(400).json({ status: 'error', message: 'All fields required' });

    // Verify OTP
    const stored = otpStore[tg_id];
    if (!stored)
      return res.status(400).json({ status: 'error', message: 'OTP nahi bheja gaya! Pehle OTP send karo.' });
    if (Date.now() > stored.expires)
      return res.status(400).json({ status: 'error', message: 'OTP expire ho gaya! Dobara send karo.' });
    if (stored.otp !== otp.toString())
      return res.status(400).json({ status: 'error', message: 'Wrong OTP! Try again.' });

    delete otpStore[tg_id];

    const exists = await User.findOne({ mobile });
    if (exists) return res.status(400).json({ status: 'error', message: 'Mobile already registered' });

    const tgExists = await User.findOne({ tg_id });
    if (tgExists) return res.status(400).json({ status: 'error', message: 'Ye Telegram ID pehle se registered hai!' });

    const wallet_id = 'UW' + Date.now().toString().slice(-6);
    const api_key   = 'UW-' + Math.random().toString(36).substr(2, 12).toUpperCase();

    // pin is placeholder '0000' from frontend — actual PIN is set via /auth/set-pin after login
    const user = await User.create({
      name, mobile, password,
      pin: pin || '0000',
      pin_set: false,     // PIN not yet properly set
      tg_id, wallet_id, api_key, balance: 0
    });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });

    await sendTG(tg_id,
      `✅ <b>Account Created!</b>\n\n` +
      `👤 Name: <b>${name}</b>\n` +
      `📱 Mobile: <b>${mobile}</b>\n` +
      `💼 Wallet ID: <b>${wallet_id}</b>\n\n` +
      `Welcome to UNIO Wallet! ❤️`
    );

    await sendTG(ADMIN_TG,
      `🆕 <b>New User Joined!</b>\n\n` +
      `👤 Name: <b>${name}</b>\n` +
      `📱 Mobile: <b>${mobile}</b>\n` +
      `🤖 TG ID: <b>${tg_id}</b>\n` +
      `💼 Wallet ID: <b>${wallet_id}</b>`
    );

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
        tg_id:     user.tg_id || '',
        pin_set:   false
      }
    });
  } catch(e) {
    console.error('Register error:', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    console.log('DB State:', mongoose.connection.readyState);
    console.log('Login attempt:', req.body?.mobile);

    const { mobile, password } = req.body;
    if (!mobile || !password)
      return res.status(400).json({ status: 'error', message: 'Mobile and password required' });

    const user = await User.findOne({ mobile });
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });

    const match = await user.matchPassword(password);
    if (!match) return res.status(401).json({ status: 'error', message: 'Invalid password' });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });

    if (user.tg_id) {
      await sendTG(user.tg_id,
        `🔐 <b>Login Alert!</b>\n\n` +
        `📱 Mobile: <b>${mobile}</b>\n` +
        `⏰ Time: <b>${new Date().toLocaleString('en-IN')}</b>\n\n` +
        `If this wasn't you, change your password immediately!`
      );
    }

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
        tg_id:     user.tg_id || '',
        pin_set:   user.pin_set || false
      }
    });
  } catch(e) {
    console.error('Login error:', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Set PIN (after register/first login) ─────────────────────────────────────
router.post('/set-pin', auth, async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || pin.toString().length !== 4)
      return res.status(400).json({ status: 'error', message: 'PIN must be 4 digits' });

    await User.findByIdAndUpdate(req.user.id, {
      pin:     pin.toString(),
      pin_set: true
    });

    res.json({ status: 'success', message: 'PIN set successfully' });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Verify PIN (dashboard access) ────────────────────────────────────────────
router.post('/verify-pin', auth, async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ status: 'error', message: 'PIN required' });

    const user = await User.findById(req.user.id).select('+pin');
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });

    if (user.pin !== pin.toString())
      return res.status(401).json({ status: 'error', message: 'Wrong PIN' });

    res.json({ status: 'success', message: 'PIN verified' });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Verify Password (for change-pin flow) ────────────────────────────────────
router.post('/verify-password', auth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ status: 'error', message: 'Password required' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });

    const match = await user.matchPassword(password);
    if (!match) return res.status(401).json({ status: 'error', message: 'Wrong password' });

    res.json({ status: 'success', message: 'Password verified' });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Change PIN (password verified → new PIN) ─────────────────────────────────
router.post('/change-pin', auth, async (req, res) => {
  try {
    const { new_pin } = req.body;
    if (!new_pin || new_pin.toString().length !== 4)
      return res.status(400).json({ status: 'error', message: 'New PIN must be 4 digits' });

    await User.findByIdAndUpdate(req.user.id, {
      pin:     new_pin.toString(),
      pin_set: true
    });

    res.json({ status: 'success', message: 'PIN changed successfully' });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Forgot PIN: Send OTP to Telegram ─────────────────────────────────────────
router.post('/forgot-pin-otp', async (req, res) => {
  try {
    const { tg_id } = req.body;
    if (!tg_id) return res.status(400).json({ status: 'error', message: 'Telegram ID required' });

    // Check if this tg_id exists in DB
    const user = await User.findOne({ tg_id });
    if (!user) return res.status(404).json({ status: 'error', message: 'Koi account nahi mila is Telegram ID se!' });

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    pinOtpStore[tg_id] = { otp, expires: Date.now() + 5 * 60 * 1000 };

    await sendTG(tg_id,
      `🔑 <b>PIN Reset OTP</b>\n\n` +
      `<b>Confirm your verification</b>\n\n` +
      `🔢 <b>OTP = ${otp}</b>\n\n` +
      `Valid for 5 minutes.\n` +
      `Do not share this OTP with anyone!\n\n` +
      `UNIO Wallet Security Team 🛡️`
    );

    res.json({ status: 'success', message: 'OTP sent!' });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Forgot PIN: Verify OTP ────────────────────────────────────────────────────
router.post('/verify-forgot-pin-otp', async (req, res) => {
  try {
    const { tg_id, otp } = req.body;
    if (!tg_id || !otp) return res.status(400).json({ status: 'error', message: 'tg_id and otp required' });

    const stored = pinOtpStore[tg_id];
    if (!stored) return res.status(400).json({ status: 'error', message: 'OTP nahi bheja gaya!' });
    if (Date.now() > stored.expires) return res.status(400).json({ status: 'error', message: 'OTP expire ho gaya!' });
    if (stored.otp !== otp.toString()) return res.status(400).json({ status: 'error', message: 'Wrong OTP!' });

    // Don't delete yet — keep until reset is done
    res.json({ status: 'success', message: 'OTP verified' });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Forgot PIN: Reset PIN ─────────────────────────────────────────────────────
router.post('/reset-pin', async (req, res) => {
  try {
    const { tg_id, new_pin } = req.body;
    if (!tg_id || !new_pin) return res.status(400).json({ status: 'error', message: 'tg_id and new_pin required' });
    if (new_pin.toString().length !== 4) return res.status(400).json({ status: 'error', message: 'PIN must be 4 digits' });

    // Check OTP was verified (still in store)
    const stored = pinOtpStore[tg_id];
    if (!stored) return res.status(400).json({ status: 'error', message: 'OTP verification required first!' });

    const user = await User.findOne({ tg_id });
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });

    await User.findByIdAndUpdate(user._id, { pin: new_pin.toString(), pin_set: true });
    delete pinOtpStore[tg_id];

    await sendTG(tg_id,
      `✅ <b>PIN Reset Successful!</b>\n\n` +
      `Your UNIO Wallet PIN has been reset.\n` +
      `If this wasn't you, contact support immediately! 🛡️`
    );

    res.json({ status: 'success', message: 'PIN reset successfully' });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Update Telegram ID ────────────────────────────────────────────────────────
router.post('/update-tg', auth, async (req, res) => {
  try {
    const { tg_id } = req.body;
    if (tg_id) {
      const existing = await User.findOne({ tg_id, _id: { $ne: req.user.id } });
      if (existing) return res.json({ status: 'error', message: 'Ye Telegram ID pehle se kisi aur account mein linked hai!' });
    }
    await User.findByIdAndUpdate(req.user.id, { tg_id: tg_id || '' });
    res.json({ status: 'success', message: 'Telegram ID updated' });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Update TG by Mobile (claim page) ─────────────────────────────────────────
router.post('/update-tg-by-mobile', async (req, res) => {
  try {
    const { mobile, tg_id } = req.body;
    if (!mobile || !tg_id) return res.status(400).json({ status: 'error', message: 'mobile and tg_id required' });

    if (tg_id) {
      const existing = await User.findOne({ tg_id, mobile: { $ne: mobile } });
      if (existing) return res.json({ status: 'error', message: 'Ye Telegram ID pehle se kisi aur account mein linked hai!' });
    }

    await User.findOneAndUpdate({ mobile }, { tg_id });
    res.json({ status: 'success', message: 'Telegram ID updated' });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Check Mobile ──────────────────────────────────────────────────────────────
router.post('/check-mobile', async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile) return res.status(400).json({ status: 'error', message: 'Mobile required' });
    const user = await User.findOne({ mobile }).select('name mobile tg_id');
    if (!user) return res.json({ status: 'error', message: 'User not found' });
    res.json({ status: 'success', name: user.name, mobile: user.mobile, tg_id: user.tg_id || '' });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Regen API Key ─────────────────────────────────────────────────────────────
router.post('/regen-key', auth, async (req, res) => {
  try {
    const api_key = 'UW-' + Math.random().toString(36).substr(2, 12).toUpperCase();
    await User.findByIdAndUpdate(req.user.id, { api_key });
    res.json({ status: 'success', api_key });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Test Route ────────────────────────────────────────────────────────────────
router.get('/test', async (req, res) => {
  try {
    const state  = mongoose.connection.readyState;
    const states = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
    res.json({
      status: 'success', db_state: states[state] || 'unknown',
      db_state_code: state, mongo_uri_set: !!process.env.MONGO_URI,
      time: new Date().toISOString()
    });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;
      
