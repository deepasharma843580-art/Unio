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

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth',     require('./routes/auth'));
app.use('/wallet',   require('./routes/wallet'));
app.use('/transfer', require('./routes/transfer'));
app.use('/lifafa',   require('./routes/lifafa'));
app.use('/admin',    require('./routes/admin'));
app.use('/payment',  payLimiter, require('./routes/payment'));
app.use('/api',      payLimiter, require('./routes/payment'));
app.use('/migrate',  require('./routes/migrate')); // ── Migration route ──

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
