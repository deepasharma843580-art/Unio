const router      = require('express').Router();
const User        = require('../models/User');
const Lifafa      = require('../models/Lifafa');
const Transaction = require('../models/Transaction');
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
  } catch(e) {
    console.error('sendTG error | tg_id:', tg_id, '| msg:', e.response?.data || e.message);
  }
}

// ── Create Lifafa ─────────────────────────────────────────────────────────────
router.post('/create', auth, async (req, res) => {
  try {
    const { code, type, amt, min_range, max_range, toss_answer, users, channels, refer_bonus } = req.body;

    const total = (type === 'scratch')
      ? (parseFloat(max_range) * parseInt(users))
      : (parseFloat(amt) * parseInt(users));

    const sender = await User.findById(req.user._id).select('+tg_id +name +mobile +balance');
    if(!sender) return res.status(404).json({ status:'error', message:'User not found' });
    console.log('CREATE LIFAFA | sender:', sender.mobile, '| tg_id:', sender.tg_id || 'NOT FOUND');

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
`🎁 *Lifafa Created!*

━━━━━━━━━━━━━━
🎁   UNIO LIFAFA ✅
━━━━━━━━━━━━━━

🔑 Code : \`${lifafa.code}\`
📋 Type : ${type.toUpperCase()}
👥 Users : ${users}
💰 Amount : ₹${amt || max_range}
💸 Total Deducted : ₹${total}
📅 Date : ${new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata',hour12:true})}

━━━━━━━━━━━━━━
Claim Link: /claim.html?code=${lifafa.code}
Share karo! 🚀`
      );
    }

    // TG to Admin
    sendTG(ADMIN_TG_ID,
`🎁 *New Lifafa Created*

👤 By : ${sender.name} (${sender.mobile})
🔑 Code : \`${lifafa.code}\`
📋 Type : ${type} | 👥 ${users} users
💸 Total : ₹${total}`
    );

    res.json({
      status:         'success',
      code:           lifafa.code,
      claim_url:      `/claim.html?code=${lifafa.code}`,
      total_deducted: total,
      refer_bonus:    lifafa.refer_bonus
    });

  } catch(e) {
    res.status(500).json({ status:'error', message: e.message });
  }
});

// ── Get Lifafa Info ───────────────────────────────────────────────────────────
router.get('/:code', async (req, res) => {
  try {
    const l = await Lifafa.findOne({ code: req.params.code.toUpperCase(), status: 'active' })
      .populate('creator_id', 'name');
    if(!l) return res.status(404).json({ status:'error', message:'Invalid or expired code' });
    res.json({ status:'success', lifafa: l });
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

    // Amount
    let amt = lifafa.per_user_amount;
    if(lifafa.type === 'scratch') {
      amt = Math.floor(Math.random() * (lifafa.max_range * 100 - lifafa.min_range * 100 + 1) + lifafa.min_range * 100) / 100;
    }

    // Toss check
    if(lifafa.type === 'toss' && (!guess || guess.toUpperCase() !== lifafa.toss_answer.toUpperCase())) {
      await Transaction.create({
        receiver_id: user._id, amount: 0, remark: rem,
        type: 'transfer', status: 'failed', tx_time: new Date()
      });
      return res.status(400).json({ status:'error', message:'Wrong guess! Locked.' });
    }

    const now = new Date();
    const dt  = now.toLocaleString('en-IN', { timeZone:'Asia/Kolkata', hour12:true });

    // Add balance to claimer
    await User.findByIdAndUpdate(user._id, { $inc: { balance: +amt } });

    // Update claimed count
    const newClaimed = lifafa.claimed_users + 1;
    await Lifafa.findByIdAndUpdate(lifafa._id, { $inc: { claimed_users: 1 } });

    // Transaction for claimer
    await Transaction.create({
      receiver_id: user._id, amount: amt, remark: rem,
      type: 'transfer', status: 'success', tx_time: now
    });

    // TG to claimer
    if(user.tg_id) {
      sendTG(user.tg_id,
`🎉 *Lifafa Claimed!*

━━━━━━━━━━━━━━
🎁   UNIO LIFAFA ✅
━━━━━━━━━━━━━━

🔑 Code : \`${code}\`
💰 Amount : ₹${amt}
👥 ${newClaimed}/${lifafa.max_users} Claimed
📅 Time : ${dt}

✅ Balance mein add ho gaya!`
      );
    }

    // TG to creator
    const creator = await User.findById(lifafa.creator_id).select('tg_id name');
    if(creator?.tg_id) {
      sendTG(creator.tg_id,
`👋 *Someone Claimed Your Lifafa!*

🔑 Code : \`${code}\`
👤 By : ${user.name} (${mobile})
💰 Amount : ₹${amt}
👥 ${newClaimed}/${lifafa.max_users} Claimed
📅 Time : ${dt}

${newClaimed >= lifafa.max_users ? '🔴 Lifafa Full Ho Gaya!' : `⏳ ${lifafa.max_users - newClaimed} slots bache hain`}`
      );
    }

    // ── Refer Bonus ───────────────────────────────────────────────────────────
    let referBonus = 0;
    if(ref_code && lifafa.refer_bonus > 0) {
      const referrer = await User.findOne({ ref_code });
      if(referrer && referrer.mobile !== mobile) {
        referBonus = lifafa.refer_bonus;
        await User.findByIdAndUpdate(referrer._id, { $inc: { balance: referBonus } });
        await Transaction.create({
          receiver_id: referrer._id,
          amount:      referBonus,
          remark:      `Refer Bonus: ${mobile} ne ${code} claim kiya`,
          type:        'transfer',
          status:      'success',
          tx_time:     now
        });
        // TG to referrer
        if(referrer.tg_id) {
          sendTG(referrer.tg_id,
`💰 *Refer Bonus Mila!*

━━━━━━━━━━━━━━
🎁   UNIO REFER BONUS ✅
━━━━━━━━━━━━━━

👤 ${user.name} (${mobile}) ne aapke refer link se claim kiya!
🔑 Lifafa : \`${code}\`
💰 Bonus : ₹${referBonus}
📅 Time : ${dt}

✅ Balance mein add ho gaya!`
          );
        }
      }
    }

    // ── Auto Delete if Full ───────────────────────────────────────────────────
    if(newClaimed >= lifafa.max_users) {
      await Lifafa.findByIdAndDelete(lifafa._id);

      // TG to admin — lifafa full & deleted
      sendTG(ADMIN_TG_ID,
`🔴 *Lifafa Full & Deleted!*

🔑 Code : \`${code}\`
👤 Creator : ${creator?.name || '—'} 
👥 Total Claimed : ${newClaimed}
📅 Time : ${dt}

🗑️ Database se auto delete ho gaya!`
      );

      // TG to creator — lifafa completed
      if(creator?.tg_id) {
        sendTG(creator.tg_id,
`🎊 *Lifafa Complete Ho Gaya!*

🔑 Code : \`${code}\`
👥 Sabne Claim Kar Liya : ${newClaimed}/${lifafa.max_users}
📅 Time : ${dt}

✅ Lifafa successfully completed!`
        );
      }
    }

    res.json({
      status:      'success',
      amount:      amt,
      refer_bonus: referBonus,
      message:     `₹${amt} added to wallet!`
    });

  } catch(e) {
    res.status(500).json({ status:'error', message: e.message });
  }
});

module.exports = router;
