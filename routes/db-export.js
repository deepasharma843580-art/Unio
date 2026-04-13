// routes/db-export.js
// ─────────────────────────────────────────────────────────────────────────────
//  MongoDB Full Database Export
//
//  GET  /db-export/collections          → list all collections + count
//  GET  /db-export/download/:collection → download one collection as JSON
//  GET  /db-export/all                  → download ALL collections as one JSON
// ─────────────────────────────────────────────────────────────────────────────

const router   = require('express').Router();
const mongoose = require('mongoose');

const ADMIN_SECRET = process.env.ADMIN_SECRET || '8435';

// ── Admin Auth ────────────────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (!secret || secret !== ADMIN_SECRET)
    return res.status(403).json({ status: 'error', message: 'Unauthorized' });
  next();
}

// ── List all collections ──────────────────────────────────────────────────────
router.get('/collections', adminAuth, async (req, res) => {
  try {
    const db          = mongoose.connection.db;
    const collections = await db.listCollections().toArray();

    const result = await Promise.all(
      collections.map(async (col) => {
        const count = await db.collection(col.name).countDocuments();
        return { name: col.name, count };
      })
    );

    res.json({ status: 'success', collections: result });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Download one collection as JSON ──────────────────────────────────────────
router.get('/download/:collection', adminAuth, async (req, res) => {
  try {
    const db   = mongoose.connection.db;
    const name = req.params.collection;

    const cols = await db.listCollections({ name }).toArray();
    if (!cols.length)
      return res.status(404).json({ status: 'error', message: 'Collection not found' });

    const docs     = await db.collection(name).find({}).toArray();
    const filename = `${name}_${new Date().toISOString().slice(0,10)}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(docs, null, 2));
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Download ALL collections as one JSON ─────────────────────────────────────
router.get('/all', adminAuth, async (req, res) => {
  try {
    const db          = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const result      = {};

    for (const col of collections) {
      result[col.name] = await db.collection(col.name).find({}).toArray();
    }

    const filename = `unio_db_${new Date().toISOString().slice(0,10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(result, null, 2));
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

module.exports = router;
    
