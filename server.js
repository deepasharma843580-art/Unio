require('dotenv').config();
const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── MongoDB ───────────────────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;
mongoose.set('bufferCommands', true);
mongoose.set('bufferTimeoutMS', 60000);

let isConnected = false;

async function connectDB() {
  if(isConnected && mongoose.connection.readyState === 1) return;
  try {
    if(mongoose.connection.readyState === 0) {
      await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 60000,
        socketTimeoutMS:          60000,
        connectTimeoutMS:         60000,
        maxPoolSize:              10,
        minPoolSize:              1,
        retryWrites:              true,
      });
    } else {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 30000);
        mongoose.connection.once('connected', () => { clearTimeout(timeout); resolve(); });
        mongoose.connection.once('error', (err) => { clearTimeout(timeout); reject(err); });
      });
    }
    isConnected = true;
    console.log('✅ MongoDB Connected');
  } catch(e) {
    isConnected = false;
    console.error('❌ DB Error:', e.message);
    throw e;
  }
}

// ── DB Middleware ─────────────────────────────────────────────────────────────
app.use(async (req, res, next) => {
  if(req.path.endsWith('.html') || req.path.endsWith('.css') ||
     req.path.endsWith('.js')   || req.path === '/favicon.ico') {
    return next();
  }
  try {
    await connectDB();
    next();
  } catch(e) {
    res.status(500).json({ status:'error', message:'Database connection failed: '+e.message });
  }
});

// ── Static files — no cache ───────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    if(filePath.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if(filePath.endsWith('.css'))  res.setHeader('Content-Type', 'text/css');
    if(filePath.endsWith('.js'))   res.setHeader('Content-Type', 'application/javascript');
  }
}));

// ── Rate Limit ────────────────────────────────────────────────────────────────
const payLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { status:'error', message:'Too many requests' }
});

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { status:'error', message:'Too many AI requests, thodi der baad try karo' }
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth',        require('./routes/auth'));
app.use('/wallet',      require('./routes/wallet'));
app.use('/transfer',    require('./routes/transfer'));
app.use('/lifafa',      require('./routes/lifafa'));
app.use('/admin',       require('./routes/admin'));
app.use('/payment',     payLimiter, require('./routes/payment'));
app.use('/api',         payLimiter, require('./routes/payment'));
app.use('/giftcode',    require('./routes/giftCode'));
app.use('/migrate',     require('./routes/migrate'));
app.use('/leaderboard',      require('./routes/leaderboard'));           // ✅ Leaderboard
app.use('/ai',               aiLimiter, require('./routes/ai'));          // ✅ AI Chat
app.use('/reset',            require('./routes/reset'));                  // ✅ Reset Panel
app.use('/deposit-gateway',  require('./routes/deposit-gateway'));        // ✅ Payment Gateway
app.use('/redeem',           require('./routes/redeem'));  // ✅ Redeem Codes
app.use('/db-export', require('./routes/db-export'));
app.use('/keeper',           require('./routes/keeper'));                  // ✅ Balance Keeper
app.use('/envelope',         require('./routes/envelope'));
app.use('/card',       require('./routes/card'));
app.use('/card-admin', require('./routes/card-admin'));
app.use('/circle', require('./routes/circle'));
app.use('/admin',  require('./routes/admin-circle'));  // existing /admin ke saath merge karo ya alag rakho
app.use('/game',             require('./routes/game'));
app.use('/api/lite',  require('./routes/lite'));
app.use('/tgch',  require('./routes/tgch'));               // ✅ TG Manager
app.use('/', require('./routes/admin-with'));   // ✅ Today Withdrawals
app.use('/ulite',            require('./routes/ulite'));

// ── HTML Pages ────────────────────────────────────────────────────────────────
app.get('/',              (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/transfer',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'transfer.html')));
app.get('/deposit',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'deposit.html')));
app.get('/withdraw',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'withdraw.html')));
app.get('/lifafa-create', (req, res) => res.sendFile(path.join(__dirname, 'public', 'lifafa.html')));
app.get('/claim',         (req, res) => res.sendFile(path.join(__dirname, 'public', 'claim.html')));
app.get('/tg',            (req, res) => res.sendFile(path.join(__dirname, 'public', 'tg.html')));
app.get('/admin-panel',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'admindash.html')));
app.get('/sahab',         (req, res) => res.sendFile(path.join(__dirname, 'public', 'sahab.html')));
app.get('/transactions',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'transactions.html')));
app.get('/settings',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'settings.html')));
app.get('/qr',            (req, res) => res.sendFile(path.join(__dirname, 'public', 'qr.html')));
app.get('/migrate-tool',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'migrate.html')));
app.get('/parese',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'parese.html')));
app.get('/leaderboard',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'lead.html')));         // ✅ Leaderboard
app.get('/reset-panel',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'reset-panel.html')));  // ✅ Reset Panel
app.get('/pay/:id',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'pay.html')));          // ✅ Gateway Pay Page
app.get('/redeem-store',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'redeem.html')));       // ✅ Redeem User Page
app.get('/redeem-admin',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'redeem-admin.html'))); // ✅ Redeem Admin
app.get('/db-export-panel', (req, res) => res.sendFile(path.join(__dirname, 'public', 'db-export.html')));
app.get('/keeper',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'keeper.html')));        // ✅ Keeper
app.get('/envelopes',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'envelopes.html')));
app.get('/envelope-admin',(req, res) => res.sendFile(path.join(__dirname, 'public', 'envelope-admin.html')));
app.get('/card',       (req, res) => res.sendFile(...'card.html'));
app.get('/card-admin', (req, res) => res.sendFile(...'card-admin.html'));
app.get('/circle',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'circle.html')));
app.get('/circle-admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'circle-admin.html')));
app.get('/games',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'games.html')));
app.get('/game-admin',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'game-admin.html')));
app.get('/tgch-panel', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tgch.html')));  // ✅ TG Panel
// ── Fallback ──────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Local Server ──────────────────────────────────────────────────────────────
if(process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 UNIO on port ${PORT}`));
}

module.exports = app;
