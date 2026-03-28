const router    = require('express').Router();
const crypto    = require('crypto');
const User      = require('../models/User');
const ForgotOtp = require('../models/ForgotOtp');

const BOT_TOKEN = process.env.BOT_TOKEN || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';

// ── Send Telegram Message ─────────────────────────────────────────────────────
async function sendTG(chat_id, text) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id, text, parse_mode: 'HTML' })
    });
  } catch (e) {
    console.error('TG send error:', e.message);
  }
}

// ── POST /auth/forgot-send-otp ────────────────────────────────────────────────
// Body: { mobile, tg_id }
router.post('/forgot-send-otp', async (req, res) => {
  try {
    const { mobile, tg_id } = req.body;
    if (!mobile || !tg_id)
      return res.status(400).json({ status: 'error', message: 'mobile aur tg_id required hai' });

    const user = await User.findOne({ mobile });
    if (!user)
      return res.status(404).json({ status: 'error', message: 'Is mobile se koi account nahi mila' });

    if (!user.tg_id || user.tg_id.toString() !== tg_id.toString())
      return res.status(400).json({ status: 'error', message: 'Telegram ID match nahi kar raha' });

    const otp         = Math.floor(1000 + Math.random() * 9000).toString();
    const otp_expires = new Date(Date.now() + 5 * 60 * 1000); // 5 min

    await ForgotOtp.findOneAndUpdate(
      { mobile },
      {
        tg_id:         tg_id.toString(),
        otp,
        otp_expires,
        reset_token:   null,
        token_expires: null,
        createdAt:     new Date()
      },
      { upsert: true, new: true }
    );

    await sendTG(tg_id,
      `🔑 <b>FORGOT PASSWORD</b>\n\n` +
      `OTP = <b>${otp}</b>\n\n` +
      `⏳ Valid for 5 minutes only.\n\n` +
      `🔒 KEEP YOUR PASSWORD SAFE\n\n` +
      `Thanks from <b>UNIO HAZEL</b> ❤️`
    );

    res.json({ status: 'success', message: 'OTP sent on Telegram' });
  } catch (e) {
    console.error('forgot-send-otp error:', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── POST /auth/forgot-verify-otp ──────────────────────────────────────────────
// Body: { mobile, tg_id, otp }
router.post('/forgot-verify-otp', async (req, res) => {
  try {
    const { mobile, tg_id, otp } = req.body;
    if (!mobile || !tg_id || !otp)
      return res.status(400).json({ status: 'error', message: 'mobile, tg_id, otp sab required' });

    const record = await ForgotOtp.findOne({ mobile });
    if (!record || !record.otp)
      return res.status(400).json({ status: 'error', message: 'OTP nahi mila. Pehle OTP bhejo.' });

    if (new Date() > record.otp_expires)
      return res.status(400).json({ status: 'error', message: 'OTP expire ho gaya! Dobara bhejo.' });

    if (record.tg_id !== tg_id.toString())
      return res.status(400).json({ status: 'error', message: 'Telegram ID mismatch' });

    if (record.otp !== otp.toString())
      return res.status(400).json({ status: 'error', message: 'Wrong OTP! Try again.' });

    const reset_token   = crypto.randomBytes(24).toString('hex');
    const token_expires = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await ForgotOtp.findOneAndUpdate(
      { mobile },
      {
        otp:           null,
        otp_expires:   null,
        reset_token,
        token_expires,
        createdAt:     new Date()
      }
    );

    res.json({ status: 'success', reset_token, message: 'OTP verified!' });
  } catch (e) {
    console.error('forgot-verify-otp error:', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── POST /auth/forgot-reset-password ─────────────────────────────────────────
// Body: { mobile, reset_token, new_password }
router.post('/forgot-reset-password', async (req, res) => {
  try {
    const { mobile, reset_token, new_password } = req.body;
    if (!mobile || !reset_token || !new_password)
      return res.status(400).json({ status: 'error', message: 'mobile, reset_token, new_password required' });

    if (new_password.length < 6)
      return res.status(400).json({ status: 'error', message: 'Password min 6 characters ka hona chahiye' });

    const record = await ForgotOtp.findOne({ mobile });
    if (!record || !record.reset_token)
      return res.status(400).json({ status: 'error', message: 'Reset session nahi mili. Dobara try karo.' });

    if (new Date() > record.token_expires)
      return res.status(400).json({ status: 'error', message: 'Session expire ho gayi! Dobara forgot password use karo.' });

    if (record.reset_token !== reset_token)
      return res.status(400).json({ status: 'error', message: 'Invalid reset token' });

    const user = await User.findOne({ mobile });
    if (!user)
      return res.status(404).json({ status: 'error', message: 'User not found' });

    user.password = new_password;
    await user.save(); // bcrypt pre-save hook trigger hoga

    await ForgotOtp.deleteOne({ mobile });

    if (user.tg_id) {
      await sendTG(user.tg_id,
        `✅ <b>Password Changed!</b>\n\n` +
        `📱 Mobile: <b>${mobile}</b>\n` +
        `⏰ Time: <b>${new Date().toLocaleString('en-IN')}</b>\n\n` +
        `Agar yeh aapne nahi kiya toh turant support se contact karo!\n\n` +
        `<b>UNIO HAZEL</b> ❤️`
      );
    }

    res.json({ status: 'success', message: 'Password successfully change ho gaya!' });
  } catch (e) {
    console.error('forgot-reset-password error:', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;
        
