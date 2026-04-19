const router      = require('express').Router();
const User        = require('../models/User');
const Lifafa      = require('../models/Lifafa');
const Transaction = require('../models/Transaction');
const { auth }    = require('../middleware/auth');
const axios       = require('axios');

const BOT_TOKEN   = process.env.BOT_TOKEN   || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';
const ADMIN_TG_ID = process.env.ADMIN_TG_ID || '8509393869';

async function sendTG(tg_id, text) {
  if (!tg_id) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: tg_id, text, parse_mode: 'Markdown'
    }, { timeout: 8000 });
  } catch(e) {}
}

function istTime() {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', hour12: true,
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /lifafa/referrer-by-mobile/:mobile
// Claim page pe "Referred By" dikhane ke liye
// ref_code = referrer ka mobile number
// ─────────────────────────────────────────────────────────────────────────────
router.get('/referrer-by-mobile/:mobile', async (req, res) => {
  try {
    const referrer = await User.findOne({ mobile: req.params.mobile }).select('name mobile');
    if (!referrer) return res.status(404).json({ status: 'error', message: 'User not found' });
    res.json({ status: 'success', name: referrer.name, mobile: referrer.mobile });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /lifafa/referrer/:walletId   (purana route — backward compat)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/referrer/:walletId', async (req, res) => {
  try {
    const referrer = await User.findOne({ wallet_id: req.params.walletId }).select('name');
    if (!referrer) return res.status(404).json({ status: 'error', message: 'Invalid Referrer' });
    res.json({ status: 'success', name: referrer.name });
  } catch(e) {
    res.status(500).json({ status: 'error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /lifafa/create
// ─────────────────────────────────────────────────────────────────────────────
router.post('/create', auth, async (req, res) => {
  try {
    const { code, type, amt, min_range, max_range, toss_answer, users, channels, refer_bonus } = req.body;

    const total = (type === 'scratch')
      ? (parseFloat(max_range) * parseInt(users))
      : (parseFloat(amt)       * parseInt(users));

    const sender = await User.findById(req.user._id);
    if (!sender) return res.status(404).json({ status: 'error', message: 'User not found' });

    if (sender.balance < total)
      return res.status(400).json({ status: 'error', message: `Insufficient balance. Need ₹${total}` });

    if (await Lifafa.findOne({ code: code.toUpperCase() }))
      return res.status(400).json({ status: 'error', message: 'Code already exists' });

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
      per_user_amount: parseFloat(amt)       || 0,
      min_range:       parseFloat(min_range) || 0,
      max_range:       parseFloat(max_range) || 0,
      toss_answer:     toss_answer           || '',
      max_users:       parseInt(users),
      channels:        channels              || [],
      refer_bonus:     parseFloat(refer_bonus) || 0
    });

    const dt = istTime();

    if (sender.tg_id) {
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
🎯 Refer Bonus : ${parseFloat(refer_bonus) > 0 ? '₹' + refer_bonus + ' per refer' : 'Off'}
📅 Date : ${dt}

━━━━━━━━━━━━━━
Claim Link: ${process.env.APP_URL || ''}/claim.html?code=${lifafa.code}
Share karo! 🚀`
      );
    }

    sendTG(ADMIN_TG_ID,
`🎁 *New Lifafa Created*

👤 By : ${sender.name} (${sender.mobile})
🔑 Code : \`${lifafa.code}\`
📋 Type : ${type} | 👥 ${users} users
💸 Total : ₹${total}
🎯 Refer : ${parseFloat(refer_bonus) > 0 ? '₹' + refer_bonus : 'Off'}`
    );

    res.json({
      status:         'success',
      code:           lifafa.code,
      claim_url:      `/claim.html?code=${lifafa.code}`,
      total_deducted: total,
      refer_bonus:    lifafa.refer_bonus
    });

  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /lifafa/:code
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:code', async (req, res) => {
  try {
    const l = await Lifafa.findOne({ code: req.params.code.toUpperCase(), status: 'active' })
      .populate('creator_id', 'name');
    if (!l) return res.status(404).json({ status: 'error', message: 'Invalid or expired code' });
    res.json({ status: 'success', lifafa: l });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /lifafa/claim
// Body: { code, mobile, guess, ref_code }
// ref_code = referrer ka MOBILE NUMBER
// ─────────────────────────────────────────────────────────────────────────────
router.post('/claim', async (req, res) => {
  try {
    const { code, mobile, guess, ref_code } = req.body;

    const user = await User.findOne({ mobile });
    if (!user) return res.status(404).json({ status: 'error', message: 'Mobile not found' });

    const lifafa = await Lifafa.findOne({ code: code.toUpperCase(), status: 'active' });
    if (!lifafa) return res.status(404).json({ status: 'error', message: 'Invalid or expired code' });

    const rem = `Loot_${code}_${mobile}`;
    if (await Transaction.findOne({ remark: rem }))
      return res.status(400).json({ status: 'error', message: 'Already claimed!' });

    if (lifafa.claimed_users >= lifafa.max_users)
      return res.status(400).json({ status: 'error', message: 'Lifafa is full!' });

    // Amount decide
    let amt = lifafa.per_user_amount;
    if (lifafa.type === 'scratch') {
      amt = Math.floor(
        Math.random() * (lifafa.max_range * 100 - lifafa.min_range * 100 + 1)
        + lifafa.min_range * 100
      ) / 100;
    }

    // Toss check
    if (lifafa.type === 'toss' && (!guess || guess.toUpperCase() !== lifafa.toss_answer.toUpperCase())) {
      await Transaction.create({
        receiver_id: user._id, amount: 0, remark: rem,
        type: 'transfer', status: 'failed', tx_time: new Date()
      });
      return res.status(400).json({ status: 'error', message: 'Wrong guess! Locked.' });
    }

    const now = new Date();
    const dt  = istTime();

    // Credit claimer
    await User.findByIdAndUpdate(user._id, { $inc: { balance: +amt } });

    const newClaimed = lifafa.claimed_users + 1;
    await Lifafa.findByIdAndUpdate(lifafa._id, { $inc: { claimed_users: 1 } });

    await Transaction.create({
      receiver_id: user._id,
      amount:      amt,
      remark:      rem,
      type:        'transfer',
      status:      'success',
      tx_time:     now
    });

    // ─────────────────────────────────────────────────────────────────────────
    // REFER BONUS LOGIC
    // ref_code = referrer ka mobile number (URL ?ref=XXXXXXXXXX)
    // ─────────────────────────────────────────────────────────────────────────
    let referBonus = 0;
    if (ref_code && lifafa.refer_bonus > 0) {

      // Referrer dhundo — mobile se
      const referrer = await User.findOne({ mobile: ref_code.toString() });

      // Self-refer aur null check
      if (referrer && referrer.mobile !== mobile) {
        referBonus = lifafa.refer_bonus;

        // Referrer ka balance badhao
        await User.findByIdAndUpdate(referrer._id, { $inc: { balance: referBonus } });

        // Transaction log
        await Transaction.create({
          receiver_id: referrer._id,
          amount:      referBonus,
          remark:      `Refer Bonus: ${mobile} ne ${code} claim kiya`,
          type:        'transfer',
          status:      'success',
          tx_time:     now
        });

        // TG to referrer
        if (referrer.tg_id) {
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

    // TG to claimer
    if (user.tg_id) {
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
    if (creator?.tg_id) {
      sendTG(creator.tg_id,
`👋 *Someone Claimed Your Lifafa!*

🔑 Code : \`${code}\`
👤 By : ${user.name} (${mobile})
💰 Amount : ₹${amt}
👥 ${newClaimed}/${lifafa.max_users} Claimed
📅 Time : ${dt}

${newClaimed >= lifafa.max_users
  ? '🔴 Lifafa Full Ho Gaya!'
  : `⏳ ${lifafa.max_users - newClaimed} slots bache hain`}`
      );
    }

    // Auto delete when full
    if (newClaimed >= lifafa.max_users) {
      await Lifafa.findByIdAndDelete(lifafa._id);

      sendTG(ADMIN_TG_ID,
`🔴 *Lifafa Full & Deleted!*

🔑 Code : \`${code}\`
👤 Creator : ${creator?.name || '—'}
👥 Total Claimed : ${newClaimed}
📅 Time : ${dt}

🗑️ Database se auto delete ho gaya!`
      );

      if (creator?.tg_id) {
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
      wallet_id:   user.wallet_id,
      message:     `₹${amt} added to wallet!`
    });

  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;
      
