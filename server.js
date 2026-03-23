require('dotenv').config();
const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const app = express();

// Basic Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── MongoDB Connection ────────────────────────────────────────────────────────
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

// ── DB Connection Middleware ──────────────────────────────────────────────────
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

// ── Static Files (Public Folder) ─────────────────────────────────────────────
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

// ── Rate Limiters ─────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { status:'error', message:'Too many requests, please try again later.' }
});

// ── Routes Registration ──────────────────────────────────────────────────────
app.use('/auth',     require('./routes/auth'));
app.use('/wallet',   require('./routes/wallet'));
app.use('/transfer', require('./routes/transfer'));
app.use('/lifafa',   require('./routes/lifafa'));
app.use('/admin',    require('./routes/admin'));

// Gift Code Route (Mounted based on giftcode.js)
app.use('/giftcode', apiLimiter, require('./routes/giftcode')); 

app.use('/payment',  apiLimiter, require('./routes/payment'));
app.use('/api',      apiLimiter, require('./routes/payment'));

// ── HTML Page Routes ──────────────────────────────────────────────────────────
app.get('/',              (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/transfer',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'transfer.html')));
app.get('/deposit',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'deposit.html')));
app.get('/withdraw',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'withdraw.html')));
app.get('/lifafa-create', (req, res) => res.sendFile(path.join(__dirname, 'public', 'lifafa.html')));
app.get('/gift-code',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'giftcode.html'))); // Gift Code Page
app.get('/claim',         (req, res) => res.sendFile(path.join(__dirname, 'public', 'claim.html')));
app.get('/tg',            (req, res) => res.sendFile(path.join(__dirname, 'public', 'tg.html')));
app.get('/admin-panel',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'admindash.html')));
app.get('/sahab',         (req, res) => res.sendFile(path.join(__dirname, 'public', 'sahab.html')));
app.get('/transactions',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'transactions.html')));
app.get('/settings',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'settings.html')));
app.get('/qr',            (req, res) => res.sendFile(path.join(__dirname, 'public', 'qr.html')));

// ── Fallback Route ────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Server Start ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 UNIO Server running on port ${PORT}`));

module.exports = app;
