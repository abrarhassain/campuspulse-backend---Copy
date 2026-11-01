const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const router = express.Router();

// Login limiter: 5 wrong tries per email and device, then a 15 minute wait
const attempts = new Map();
const MAX_TRIES = 5, WINDOW_MS = 15 * 60 * 1000;
const keyOf = req => req.ip + '|' + String(req.body.email || '').toLowerCase();
function isBlocked(k) {
  const a = attempts.get(k);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW_MS) { attempts.delete(k); return false; }
  return a.count >= MAX_TRIES;
}
function recordFail(k) {
  const a = attempts.get(k);
  if (!a || Date.now() - a.first > WINDOW_MS) attempts.set(k, { count: 1, first: Date.now() });
  else a.count++;
}
function issue(user) {
  const token = jwt.sign({ id: user.user_id, role: user.role, name: user.full_name }, process.env.JWT_SECRET, { expiresIn: '8h' });
  return { token, user: { id: user.user_id, name: user.full_name, role: user.role } };
}

// GET /api/auth/config  -> demo buttons show unless DEMO_MODE=false in .env
router.get('/config', (req, res) => res.json({ demo: process.env.DEMO_MODE === 'true' }));

// GET /api/auth/departments  -> public list for the sign-up form
router.get('/departments', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT department_id, name FROM departments ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Could not load departments.' });
  }
});

// POST /api/auth/login   body: { email, password }
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Enter your email and password.' });
    const k = keyOf(req);
    if (isBlocked(k)) return res.status(429).json({ error: 'Too many wrong tries. Please wait 15 minutes and try again.' });

    const [rows] = await db.query(
      'SELECT user_id, full_name, email, password_hash, role FROM users WHERE email = ? AND is_active = TRUE', [email]);
    const user = rows[0];
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) { recordFail(k); return res.status(401).json({ error: 'Email or password is incorrect.' }); }
    attempts.delete(k);
    res.json(issue(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
});

// POST /api/auth/register   body: { full_name, email, password, department_id, course, year_of_study }
// Self sign-up always creates a STUDENT account. Staff accounts are made by the admin.
router.post('/register', async (req, res) => {
  try {
    const { full_name, email, password, department_id, course, year_of_study } = req.body;
    if (!full_name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const [dup] = await db.query('SELECT user_id FROM users WHERE email = ?', [email]);
    if (dup[0]) return res.status(409).json({ error: 'An account with this email already exists.' });

    const hash = await bcrypt.hash(password, 10);
    const [r] = await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, department_id, course, year_of_study)
       VALUES (?, ?, ?, 'student', ?, ?, ?)`,
      [full_name.trim(), email.trim().toLowerCase(), hash, department_id || null, course || null, year_of_study || null]);
    res.status(201).json(issue({ user_id: r.insertId, full_name: full_name.trim(), role: 'student' }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create the account.' });
  }
});

module.exports = router;
