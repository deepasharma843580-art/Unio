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

// Seed default configs
async function seedConfigs() {
  for (const game of ['coin','aviator']) {
    const exists = await GameConfig.findOne({ game });
    if (!exists) await GameConfig.create({ game,
      win_chance: 70, min_bet: 5, multiplier: game==='coin'?2:0, extra_win: 3 });
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
      min_bet:    cfg.min_bet,
      extra_win:  cfg.extra_win
      // win_chance hidden from user
    }});
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

// ── POST /game/coin/play ───────────────────────────────────────────────────
// Body: { bet, choice: 'heads'|'tails' }
router.post('/coin/play', auth, async (req, res) => {
  try {
    const { bet, choice } = req.body;
    const betAmt = Math.round(parseFloat(bet)*100)/100;
    if (isNaN(betAmt) || betAmt < 1)
      return res.json({ status:'error', message:'Invalid bet' });

    const cfg  = await GameConfig.findOne({ game:'coin' });
    const minB = cfg?.min_bet || 5;
    if (betAmt < minB) return res.json({ status:'error', message:`Minimum bet ₹${minB}` });
    if (!['heads','tails'].includes(choice))
      return res.json({ status:'error', message:'Choice must be heads or tails' });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ status:'error', message:'User not found' });
    if (user.balance < betAmt)
      return res.json({ status:'error', message:`Insufficient balance. Available: ₹${user.balance}` });

    const winChance = cfg?.win_chance || 70;
    const extraWin  = cfg?.extra_win  || 3;

    // Determine result
    const roll     = Math.random() * 100;
    const userWins = roll < winChance;
    const result   = userWins ? choice : (choice==='heads'?'tails':'heads'); // coin lands on choice if win

    let pnl, newBal;
    const txId = 'CG' + Date.now() + Math.floor(Math.random()*999);
    const now  = new Date();

    if (userWins) {
      const winAmt = Math.round((betAmt * (1 + extraWin/100)) * 100) / 100; // bet + 3% extra
      pnl    = winAmt;
      newBal = Math.round((user.balance + winAmt) * 100) / 100;
      await User.findByIdAndUpdate(req.user._id, { $set: { balance: newBal } });
      await Transaction.create({
        tx_id: txId, receiver_id: req.user._id,
        amount: winAmt, type:'game_win', status:'success',
        remark:`🪙 Coin Flip Win — ${choice} — ₹${betAmt} bet`, tx_time: now
      });
    } else {
      pnl    = -betAmt;
      newBal = Math.round((user.balance - betAmt) * 100) / 100;
      await User.findByIdAndUpdate(req.user._id, { $set: { balance: newBal } });
      await Transaction.create({
        tx_id: txId, sender_id: req.user._id,
        amount: betAmt, type:'game_loss', status:'success',
        remark:`🪙 Coin Flip Loss — ${choice} — ₹${betAmt} bet`, tx_time: now
      });
    }

    res.json({
      status:  'success',
      result,          // 'heads' or 'tails'
      won:     userWins,
      bet:     betAmt,
      pnl,
      balance: newBal,
      tx_id:   txId
    });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

// ── POST /game/aviator/play ────────────────────────────────────────────────
// Body: { bet, cashout: number (e.g. 1.5 for 1.5x) }
router.post('/aviator/play', auth, async (req, res) => {
  try {
    const { bet, cashout } = req.body;
    const betAmt      = Math.round(parseFloat(bet)*100)/100;
    const cashoutMult = Math.round(parseFloat(cashout)*100)/100;

    if (isNaN(betAmt) || betAmt < 1)
      return res.json({ status:'error', message:'Invalid bet' });
    if (isNaN(cashoutMult) || cashoutMult < 1.01)
      return res.json({ status:'error', message:'Cashout must be >= 1.01x' });

    const cfg  = await GameConfig.findOne({ game:'aviator' });
    const minB = cfg?.min_bet  || 5;
    if (betAmt < minB) return res.json({ status:'error', message:`Minimum bet ₹${minB}` });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ status:'error', message:'User not found' });
    if (user.balance < betAmt)
      return res.json({ status:'error', message:`Insufficient balance. Available: ₹${user.balance}` });

    const winChance = cfg?.win_chance || 70;
    const extraWin  = cfg?.extra_win  || 3;

    // Generate crash point — higher cashout = harder to win
    const roll     = Math.random() * 100;
    // Adjust win chance based on cashout multiplier (higher mult = lower chance)
    const adjChance = Math.max(5, winChance - (cashoutMult - 1) * 15);
    const userWins  = roll < adjChance;

    // Crash point: if win, crash > cashout; if loss, crash < cashout
    let crashPoint;
    if (userWins) {
      crashPoint = Math.round((cashoutMult + Math.random() * 2) * 100) / 100;
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

// ── ADMIN — get config ─────────────────────────────────────────────────────
router.get('/admin/config', adminAuth, async (req, res) => {
  try {
    const configs = await GameConfig.find();
    res.json({ status:'success', configs });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

// ── ADMIN — update config ──────────────────────────────────────────────────
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

// ── ADMIN — stats ──────────────────────────────────────────────────────────
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

// ── ADMIN — weekly txn list ────────────────────────────────────────────────
function getWeekRange(offset=-1) {
  const now=new Date(), ist=new Date(now.getTime()+5.5*60*60*1000);
  const day=ist.getUTCDay(), diff=(day===0)?-6:1-day;
  const mon=new Date(ist); mon.setUTCDate(ist.getUTCDate()+diff); mon.setUTCHours(0,0,0,0);
  const ws=new Date(mon.getTime()+offset*7*24*3600*1000);
  const we=new Date(ws.getTime()+7*24*3600*1000-1);
  const su=new Date(ws.getTime()-5.5*60*60*1000), eu=new Date(we.getTime()-5.5*60*60*1000);
  const f=d=>d.toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric'});
  return { start:su, end:eu, label:`${f(su)} → ${f(eu)}` };
}

router.get('/admin/weeks', adminAuth, async (req, res) => {
  try {
    const oldest = await Transaction.findOne({ type:{$in:['game_win','game_loss']} }).sort({tx_time:1}).select('tx_time');
    if (!oldest) return res.json({ status:'success', weeks:[] });
    const weeks=[]; let off=-1;
    while(true) {
      const r=getWeekRange(off);
      if(r.end < oldest.tx_time) break;
      const count=await Transaction.countDocuments({ type:{$in:['game_win','game_loss']}, tx_time:{$gte:r.start,$lte:r.end} });
      weeks.push({ weekOffset:off, label:r.label, count });
      off--; if(off<-104) break;
    }
    res.json({ status:'success', weeks });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

router.delete('/admin/week', adminAuth, async (req, res) => {
  try {
    const off=parseInt(req.body.weekOffset??req.query.weekOffset??-1);
    if(off>=0) return res.status(400).json({ status:'error', message:'weekOffset must be negative' });
    const r=getWeekRange(off);
    const result=await Transaction.deleteMany({ type:{$in:['game_win','game_loss']}, tx_time:{$gte:r.start,$lte:r.end} });
    res.json({ status:'success', deleted:result.deletedCount, week:r.label });
  } catch(e) { res.status(500).json({ status:'error', message:e.message }); }
});

module.exports = router;
    
