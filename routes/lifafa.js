const router      = require('express').Router();
const User        = require('../models/User');
const Lifafa      = require('../models/Lifafa');
const Transaction = require('../models/Transaction');
const { auth }    = require('../middleware/auth');
const axios       = require('axios');

const BOT_TOKEN   = process.env.BOT_TOKEN   || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';
const ADMIN_TG_ID = process.env.ADMIN_TG_ID || '8509393869';

// Faster TG function using direct execution
async function sendTG(tg_id, text) {
  if(!tg_id) return;
  try {
    axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: tg_id, text, parse_mode: 'Markdown'
    }).catch(e => console.log("TG Error")); 
  } catch(e) {}
}

// ── Create Lifafa ─────────────────────────────────────────────────────────────
router.post('/create', auth, async (req, res) => {
  try {
    const { code, type, amt, min_range, max_range, toss_answer, users, channels, refer_bonus } = req.body;

    const total = (type === 'scratch')
      ? (parseFloat(max_range) * parseInt(users))
      : (parseFloat(amt) * parseInt(users));

    const sender = await User.findById(req.user._id);
    if(!sender) return res.status(404).json({ status:'error', message:'User not found' });

    if(sender.balance < total)
      return res.status(400).json({ status:'error', message:`Insufficient balance. Need ₹${total}` });

    if(await Lifafa.findOne({ code: code.toUpperCase() }))
      return res.status(400).json({ status:'error', message:'Code already exists' });

    await User.findByIdAndUpdate(sender._id, { $inc: { balance: -total } });

    await Transaction.create({
      sender_id: sender._id,
      amount:    total,
      type:      'transfer',
      status:    'success',
      remark:    `Created ${type} Lifafa: ${code}`,
      tx_time:   new Date()
    });

    const lifafa = await Lifafa.create({
      creator_id:      sender._id,
      creator_mobile:  sender.mobile,
      code:            code.toUpperCase(),
      type,
      per_user_amount: parseFloat(amt) || 0,
      min_range:       parseFloat(min_range) || 0,
      max_range:       parseFloat(max_range) || 0,
      toss_answer:     toss_answer || '',
      max_users:       parseInt(users),
      channels:        channels || [],
      refer_bonus:     parseFloat(refer_bonus) || 0
    });

    // TG to creator
    if(sender.tg_id) {
      sendTG(sender.tg_id,
`🎁 *Lifafa Created Successfully!*

🔑 Code : \`${lifafa.code}\`
📋 Type : ${type.toUpperCase()}
👥 Users : ${users}
💰 Amount : ₹${amt || max_range}
💸 Total Deducted : ₹${total}
📅 Date : ${new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:true})}

Claim Link: \`unio-hazel.vercel.app/claim.html?code=${lifafa.code}\``
      );
    }

    res.json({
      status:         'success',
      code:           lifafa.code,
      claim_url:      `unio-hazel.vercel.app/claim.html?code=${lifafa.code}`,
      total_deducted: total,
    });

  } catch(e) {
    res.status(500).json({ status:'error', message: e.message });
  }
});

// ── Claim Lifafa ──────────────────────────────────────────────────────────────
router.post('/claim', async (req, res) => {
  try {
    const { code, mobile, guess, ref_code } = req.body;

    const user = await User.findOne({ mobile });
    if(!user) return res.status(404).json({ status:'error', message:'Mobile not found' });

    const lifafa = await Lifafa.findOne({ code: code.toUpperCase(), status: 'active' });
    if(!lifafa) return res.status(404).json({ status:'error', message:'Invalid or expired code' });

    const rem = `Loot_${code}_${mobile}`;
    if(await Transaction.findOne({ remark: rem }))
      return res.status(400).json({ status:'error', message:'Already claimed!' });

    if(lifafa.claimed_users >= lifafa.max_users)
      return res.status(400).json({ status:'error', message:'Lifafa is full!' });

    // Amount Calculation
    let amt = lifafa.per_user_amount;
    if(lifafa.type === 'scratch') {
      amt = Math.floor(Math.random() * (lifafa.max_range * 100 - lifafa.min_range * 100 + 1) + lifafa.min_range * 100) / 100;
    }

    // Toss check
    if(lifafa.type === 'toss' && (!guess || guess.toUpperCase() !== lifafa.toss_answer.toUpperCase())) {
      return res.status(400).json({ status:'error', message:'Wrong guess! Try again.' });
    }

    const now = new Date();
    const dt  = now.toLocaleString('en-IN', { timeZone:'Asia/Kolkata', hour12:true });

    // Database Updates
    await User.findByIdAndUpdate(user._id, { $inc: { balance: +amt } });
    await Lifafa.findByIdAndUpdate(lifafa._id, { $inc: { claimed_users: 1 } });
    await Transaction.create({
      receiver_id: user._id, amount: amt, remark: rem,
      type: 'transfer', status: 'success', tx_time: now
    });

    // ── TG TO CLAIMER ──
    if(user.tg_id) {
      sendTG(user.tg_id,
`Gift code claimed successfully 🎉

*Code:* \`${code}\`
*Amount:* ₹${amt}
*Time:* ${dt}
*Type:* ${lifafa.type.toUpperCase()}

Thankyou ❤️`
      );
    }

    // ── TG TO CREATOR ──
    const creator = await User.findById(lifafa.creator_id).select('tg_id name');
    if(creator?.tg_id) {
      sendTG(creator.tg_id,
`Claim notification 🔔
*someone claimed your lifafa* ✅

*Code:* \`${code}\`
*Amount:* ₹${amt}
*Comment:* Lifafa Looted
*Number:* ${mobile.substring(0,6)}XXXX`
      );
    }

    // ── Refer Bonus logic (Alert Removed as requested) ──
    if(ref_code && lifafa.refer_bonus > 0) {
      const referrer = await User.findOne({ ref_code });
      if(referrer && referrer.mobile !== mobile) {
        await User.findByIdAndUpdate(referrer._id, { $inc: { balance: lifafa.refer_bonus } });
        await Transaction.create({
          receiver_id: referrer._id, amount: lifafa.refer_bonus,
          remark: `Refer Bonus: ${mobile}`, type: 'transfer', status: 'success', tx_time: now
        });
      }
    }

    // ── Auto Delete if Full ──
    if((lifafa.claimed_users + 1) >= lifafa.max_users) {
      await Lifafa.findByIdAndDelete(lifafa._id);
    }

    res.json({
      status: 'success',
      amount: amt,
      message: `₹${amt} added to wallet!`
    });

  } catch(e) {
    res.status(500).json({ status:'error', message: e.message });
  }
});

module.exports = router;
