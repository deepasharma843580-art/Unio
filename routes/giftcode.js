const router      = require('express').Router();
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth }    = require('../middleware/auth');
const axios       = require('axios');

const BOT_TOKEN   = process.env.BOT_TOKEN || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';
const ADMIN_TG_ID = process.env.ADMIN_TG_ID || '8509393869';

// In-memory store (MongoDB model nahi hai to simple object)
// Production mein GiftCode model banana hoga
const giftCodes = {};

async function sendTG(tg_id, text) {
  if(!tg_id) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: tg_id, text, parse_mode: 'Markdown'
    }, { timeout: 8000 });
  } catch(e) {}
}

// ── Create Gift Code ──────────────────────────────────────────────────────────
router.post('/create', auth, async (req, res) => {
  try {
    const { total_users, per_user_amount, comment } = req.body;

    if(!total_users || !per_user_amount)
      return res.json({ status:'error', message:'All fields required' });

    const users  = parseInt(total_users);
    const amount = Math.round(parseFloat(per_user_amount) * 100) / 100;

    if(isNaN(users) || users < 1 || users > 1000)
      return res.json({ status:'error', message:'Users 1 se 1000 ke beech hone chahiye' });

    if(isNaN(amount) || amount < 1)
      return res.json({ status:'error', message:'Minimum ₹1 per user' });

    const totalDeduct = Math.round(users * amount * 100) / 100;

    const sender = await User.findById(req.user._id);
    if(!sender) return res.json({ status:'error', message:'User not found' });

    if(sender.balance < totalDeduct)
      return res.json({ status:'error', message:`Insufficient balance! Need ₹${totalDeduct}, Available: ₹${sender.balance}` });

    // Generate 5 digit code
    let code;
    do {
      code = Math.floor(10000 + Math.random() * 90000).toString();
    } while(giftCodes[code]);

    const now = new Date();

    // Deduct balance
    await User.findByIdAndUpdate(sender._id, { $inc: { balance: -totalDeduct } });

    // Save code
    giftCodes[code] = {
      code,
      creator_id:     sender._id.toString(),
      creator_name:   sender.name,
      creator_mobile: sender.mobile,
      total_users:    users,
      per_user_amount: amount,
      total_amount:   totalDeduct,
      comment:        comment || '',
      claimed_by:     [],
      created_at:     now,
      active:         true
    };

    // TG Alert to creator
    if(sender.tg_id) {
      sendTG(sender.tg_id,
`🎁 *Gift Code Created Successfully!*

━━━━━━━━━━━━━━
🎁   UNIO GIFT CODE ✅
━━━━━━━━━━━━━━

🔑 Code : \`${code}\`
👥 Total Users : ${users}
💰 Per User : ₹${amount}
💸 Total Deducted : ₹${totalDeduct}
💬 Comment : ${comment||'—'}
📅 Date : ${now.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:true})}

━━━━━━━━━━━━━━
Share karo apne doston ke saath! 🚀`
      );
    }

    // TG Alert to Admin
    sendTG(ADMIN_TG_ID,
`🎁 *New Gift Code Created*

👤 By : ${sender.name} (${sender.mobile})
🔑 Code : \`${code}\`
👥 Users : ${users}
💰 Per User : ₹${amount}
💸 Total : ₹${totalDeduct}
💬 Comment : ${comment||'—'}`
    );

    res.json({
      status:       'success',
      code,
      total_users:  users,
      per_user_amount: amount,
      total_deducted: totalDeduct,
      comment:      comment || ''
    });

  } catch(e) {
    res.status(500).json({ status:'error', message: e.message });
  }
});

// ── Claim Gift Code ───────────────────────────────────────────────────────────
router.post('/claim', auth, async (req, res) => {
  try {
    const { code } = req.body;
    if(!code) return res.json({ status:'error', message:'Code required' });

    const gift = giftCodes[code];
    if(!gift) return res.json({ status:'error', message:'Invalid code!' });
    if(!gift.active) return res.json({ status:'error', message:'Code expired!' });

    const userId = req.user._id.toString();

    // Self claim check
    if(gift.creator_id === userId)
      return res.json({ status:'error', message:'Apna khud ka code claim nahi kar sakte!' });

    // Already claimed check
    if(gift.claimed_by.find(c => c.user_id === userId))
      return res.json({ status:'error', message:'Aapne yeh code pehle se claim kar liya hai!' });

    // Full check
    if(gift.claimed_by.length >= gift.total_users)
      return res.json({ status:'error', message:'Yeh code full ho gaya hai!' });

    const now    = new Date();
    const claimer = await User.findById(req.user._id);
    if(!claimer) return res.json({ status:'error', message:'User not found' });

    // Add balance
    await User.findByIdAndUpdate(req.user._id, { $inc: { balance: gift.per_user_amount } });

    // Record claim
    gift.claimed_by.push({
      user_id:   userId,
      name:      claimer.name,
      mobile:    claimer.mobile,
      amount:    gift.per_user_amount,
      claimed_at: now
    });

    // Expire if full
    if(gift.claimed_by.length >= gift.total_users) gift.active = false;

    // TG to claimer
    if(claimer.tg_id) {
      sendTG(claimer.tg_id,
`🎉 *Gift Code Claimed!*

━━━━━━━━━━━━━━
🎁   UNIO GIFT CODE ✅
━━━━━━━━━━━━━━

🔑 Code : \`${code}\`
💰 Amount : ₹${gift.per_user_amount}
💬 Comment : ${gift.comment||'—'}
📅 Time : ${now.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:true})}

✅ Balance mein add ho gaya!`
      );
    }

    // TG to creator
    const creator = await User.findById(gift.creator_id).select('tg_id');
    if(creator?.tg_id) {
      sendTG(creator.tg_id,
`👋 *Someone Claimed Your Gift Code!*

🔑 Code : \`${code}\`
👤 Claimed By : ${claimer.name} (${claimer.mobile})
💰 Amount : ₹${gift.per_user_amount}
👥 ${gift.claimed_by.length}/${gift.total_users} Claimed
📅 Time : ${now.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:true})}`
      );
    }

    res.json({
      status:  'success',
      amount:  gift.per_user_amount,
      comment: gift.comment || '',
      code,
      remaining: gift.total_users - gift.claimed_by.length
    });

  } catch(e) {
    res.status(500).json({ status:'error', message: e.message });
  }
});

// ── My Claims (user ka claim history) ────────────────────────────────────────
router.get('/my-claims', auth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const claims = [];

    Object.values(giftCodes).forEach(g => {
      const myClaim = g.claimed_by.find(c => c.user_id === userId);
      if(myClaim) {
        claims.push({
          code:         g.code,
          amount:       myClaim.amount,
          comment:      g.comment || '',
          creator_name: g.creator_name,
          claimed_at:   myClaim.claimed_at
        });
      }
    });

    // Sort by latest first
    claims.sort((a,b) => new Date(b.claimed_at) - new Date(a.claimed_at));

    res.json({ status:'success', claims });
  } catch(e) {
    res.status(500).json({ status:'error', message: e.message });
  }
});

// ── My Codes (tracking) ───────────────────────────────────────────────────────
router.get('/my-codes', auth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const myCodes = Object.values(giftCodes)
      .filter(g => g.creator_id === userId)
      .sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    res.json({ status:'success', codes: myCodes });
  } catch(e) {
    res.status(500).json({ status:'error', message: e.message });
  }
});

// ── Code Info (for claiming) ──────────────────────────────────────────────────
router.get('/info/:code', auth, async (req, res) => {
  try {
    const gift = giftCodes[req.params.code];
    if(!gift) return res.json({ status:'error', message:'Invalid code' });
    res.json({
      status:  'success',
      code:    gift.code,
      total_users: gift.total_users,
      per_user_amount: gift.per_user_amount,
      comment: gift.comment,
      claimed: gift.claimed_by.length,
      active:  gift.active,
      creator: gift.creator_name
    });
  } catch(e) {
    res.status(500).json({ status:'error', message: e.message });
  }
});

module.exports = { router, giftCodes };
      
