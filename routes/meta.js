const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// GET /api/meta  -> lists used by the dropdowns
router.get('/', authenticate, async (req, res) => {
  try {
    const [departments] = await db.query('SELECT department_id, name FROM departments ORDER BY name');
    const [categories] = await db.query('SELECT category_id, name FROM categories ORDER BY category_id');
    res.json({ departments, categories });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load the lists.' });
  }
});

module.exports = router;
