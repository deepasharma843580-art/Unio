const router      = require('express').Router();
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const GiftCode    = require('../models/GiftCode');
const { auth }    = require('../middleware/auth');
const axios       = require('axios');

const BOT_TOKEN   = process.env.BOT_TOKEN   || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';
const ADMIN_TG_ID = process.env.ADMIN_TG_ID || '8509393869';

async function sendTG(tg_id, text) {
  if(!tg_id) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: tg_id, text, parse_mode: 'Markdown'
    }, { timeout: 8000 });
  } catch(e) {}
}

// ── POST /giftcode/create ─────────────────────────────────────────────────────
router.post('/create', auth, async (req, res) => {
  try {
    const { total_users, per_user_amount, comment } = req.body;

    if(!total_users || !per_user_amount)
      return res.json({ status:'error', message:'All fields required' });

    const users  = parseInt(total_users);
    const amount = Math.round(parseFloat(per_user_amount) * 100) / 100;

    if(isNaN(users) || users < 1 || users > 1000)
      return res.json({ status:'error', message:'Users 1-1000 ke beech hone chahiye' });

    if(isNaN(amount) || amount < 1)
      return res.json({ status:'error', message:'Minimum ₹1 per user' });

    const totalDeduct = Math.round(users * amount * 100) / 100;

    const sender = await User.findById(req.user._id);
    if(!sender) return res.json({ status:'error', message:'User not found' });

    if(sender.balance < totalDeduct)
      return res.json({ status:'error', message:`Insufficient balance! Need ₹${totalDeduct}, Available: ₹${sender.balance}` });

    // 5 digit unique code — MongoDB se check
    let code;
    let tries = 0;
    do {
      code = Math.floor(10000 + Math.random() * 90000).toString();
      tries++;
    } while((await GiftCode.findOne({ code })) && tries < 20);

    const now = new Date();
    const dt  = now.toLocaleString('en-IN', { timeZone:'Asia/Kolkata', hour12:true });

    // Deduct balance
    await User.findByIdAndUpdate(sender._id, { $inc: { balance: -totalDeduct } });

    // Transaction record
    await Transaction.create({
      tx_id:     'GC' + Date.now() + Math.floor(Math.random()*9999),
      sender_id: sender._id,
      amount:    totalDeduct,
      type:      'transfer',
      status:    'success',
      remark:    `Gift Code Created: ${code}${comment ? ' | ' + comment : ''}`,
      tx_time:   now
    });

    // MongoDB mein save — sab instances pe available hoga
    await GiftCode.create({
      code,
      creator_id:      sender._id,
      creator_name:    sender.name,
      creator_mobile:  sender.mobile,
      total_users:     users,
      per_user_amount: amount,
      total_amount:    totalDeduct,
      comment:         comment || '',
      claimed_by:      [],
      created_at:      now,
      active:          true
    });

    // TG to creator
    if(sender.tg_id) {
      sendTG(sender.tg_id,
`🎁 *Gift Code Created!*

━━━━━━━━━━━━━━
🎁   UNIO GIFT CODE ✅
━━━━━━━━━━━━━━

🔑 Code : \`${code}\`
👥 Total Users : ${users}
💰 Per User : ₹${amount}
💸 Total Deducted : ₹${totalDeduct}
💬 Comment : ${comment||'—'}
📅 Date : ${dt}

━━━━━━━━━━━━━━
Share karo apne doston ke saath! 🚀`
      );
    }

    // TG to Admin
    sendTG(ADMIN_TG_ID,
`🎁 *New Gift Code Created*

👤 By : ${sender.name} (${sender.mobile})
🔑 Code : \`${code}\`
👥 Users : ${users} | ₹${amount} each
💸 Total : ₹${totalDeduct}
💬 Comment : ${comment||'—'}`
    );

    res.json({
      status:          'success',
      code,
      total_users:     users,
      per_user_amount: amount,
      total_deducted:  totalDeduct,
      comment:         comment || ''
    });

  } catch(e) {
    console.error('GiftCode create error:', e.message);
    res.status(500).json({ status:'error', message: e.message });
  }
});

// ── POST /giftcode/claim ──────────────────────────────────────────────────────
router.post('/claim', auth, async (req, res) => {
  try {
    const { code } = req.body;
    if(!code) return res.json({ status:'error', message:'Code required' });

    // MongoDB se fetch — kisi bhi instance pe kaam karega
    const gift = await GiftCode.findOne({ code });
    if(!gift)        return res.json({ status:'error', message:'Invalid code!' });
    if(!gift.active) return res.json({ status:'error', message:'Code expired!' });

    const userId  = req.user._id.toString();
    const claimer = await User.findById(req.user._id);
    if(!claimer) return res.json({ status:'error', message:'User not found' });

    // Self claim
    if(gift.creator_id.toString() === userId)
      return res.json({ status:'error', message:'Apna khud ka code claim nahi kar sakte!' });

    // Already claimed
    if(gift.claimed_by.find(c => c.user_id.toString() === userId))
      return res.json({ status:'error', message:'Aapne yeh code pehle se claim kar liya hai!' });

    // Full check
    if(gift.claimed_by.length >= gift.total_users)
      return res.json({ status:'error', message:'Yeh code full ho gaya hai!' });

    const now = new Date();
    const dt  = now.toLocaleString('en-IN', { timeZone:'Asia/Kolkata', hour12:true });

    // Add balance
    await User.findByIdAndUpdate(req.user._id, { $inc: { balance: gift.per_user_amount } });

    // Transaction record
    await Transaction.create({
      tx_id:       'GC' + Date.now() + Math.floor(Math.random()*9999),
      receiver_id: claimer._id,
      amount:      gift.per_user_amount,
      type:        'transfer',
      status:      'success',
      remark:      `Gift Code Claimed: ${code}${gift.comment ? ' | ' + gift.comment : ''}`,
      tx_time:     now
    });

    // MongoDB update
    gift.claimed_by.push({
      user_id:    claimer._id,
      name:       claimer.name,
      mobile:     claimer.mobile,
      amount:     gift.per_user_amount,
      claimed_at: now
    });
    if(gift.claimed_by.length >= gift.total_users) gift.active = false;
    await gift.save();

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
📅 Time : ${dt}

✅ Balance mein add ho gaya!`
      );
    }

    // TG to creator
    const creator = await User.findById(gift.creator_id).select('tg_id');
    if(creator?.tg_id) {
      sendTG(creator.tg_id,
`👋 *Someone Claimed Your Code!*

🔑 Code : \`${code}\`
👤 By : ${claimer.name} (${claimer.mobile})
💰 Amount : ₹${gift.per_user_amount}
👥 ${gift.claimed_by.length}/${gift.total_users} Claimed
📅 Time : ${dt}`
      );
    }

    res.json({
      status:    'success',
      amount:    gift.per_user_amount,
      comment:   gift.comment || '',
      code,
      remaining: gift.total_users - gift.claimed_by.length
    });

  } catch(e) {
    console.error('GiftCode claim error:', e.message);
    res.status(500).json({ status:'error', message: e.message });
  }
});

module.exports = router;
