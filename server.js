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

// ── Static HTML files ─────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if(filePath.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if(filePath.endsWith('.css'))  res.setHeader('Content-Type', 'text/css');
    if(filePath.endsWith('.js'))   res.setHeader('Content-Type', 'application/javascript');
  }
}));

// ── Rate Limit ────────────────────────────────────────────────────────────────
const payLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { status: 'error', message: 'Too many requests' }
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/auth',     require('./routes/auth'));
app.use('/wallet',   require('./routes/wallet'));
app.use('/transfer', require('./routes/transfer'));
app.use('/lifafa',   require('./routes/lifafa'));
app.use('/admin',    require('./routes/admin'));
app.use('/payment',  payLimiter, require('./routes/payment'));

// ── HTML Pages ────────────────────────────────────────────────────────────────
app.get('/',               (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/transfer',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'transfer.html')));
app.get('/deposit',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'deposit.html')));
app.get('/withdraw',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'withdraw.html')));
app.get('/lifafa-create',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'lifafa.html')));
app.get('/claim',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'claim.html')));
app.get('/tg',             (req, res) => res.sendFile(path.join(__dirname, 'public', 'tg.html')));
app.get('/admin-panel',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'admindash.html')));
app.get('/sahab',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'sahab.html')));
app.get('/transactions',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'transactions.html')));
app.get('/settings',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'settings.html')));
app.get('/qr',             (req, res) => res.sendFile(path.join(__dirname, 'public', 'qr.html')));

// ── Fallback ──────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── MongoDB ───────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 60000,
  socketTimeoutMS:          60000,
  connectTimeoutMS:         60000,
  maxPoolSize:              10,
})
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(e => console.error('❌ DB Error:', e.message));

// ── Server ────────────────────────────────────────────────────────────────────
if(process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 UNIO on port ${PORT}`));
}

module.exports = app;
