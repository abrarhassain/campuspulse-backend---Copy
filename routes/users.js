const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();
router.use(authenticate, requireRole('admin')); // admin only

const ROLES = ['admin', 'faculty', 'student'];
async function audit(userId, action, targetId, details) {
  await db.query('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
    [userId, action, 'user', targetId, JSON.stringify(details || {})]);
}

// GET /api/users?q=asha&role=faculty
router.get('/', async (req, res) => {
  try {
    let sql = `SELECT u.user_id, u.full_name, u.email, u.role, u.is_active, u.course, u.year_of_study, d.name AS department
               FROM users u LEFT JOIN departments d ON d.department_id = u.department_id WHERE 1=1`;
    const p = [];
    if (req.query.q) { sql += ' AND (u.full_name LIKE ? OR u.email LIKE ?)'; p.push(`%${req.query.q}%`, `%${req.query.q}%`); }
    if (req.query.role) { sql += ' AND u.role = ?'; p.push(req.query.role); }
    sql += ' ORDER BY u.created_at DESC LIMIT 200';
    const [rows] = await db.query(sql, p);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load users.' });
  }
});

// POST /api/users   body: { full_name, email, password, role, department_id, course, year_of_study }
router.post('/', async (req, res) => {
  try {
    const { full_name, email, password, role, department_id, course, year_of_study } = req.body;
    if (!full_name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Choose a role.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const [dup] = await db.query('SELECT user_id FROM users WHERE email = ?', [email]);
    if (dup[0]) return res.status(409).json({ error: 'An account with this email already exists.' });
    const hash = await bcrypt.hash(password, 10);
    const [r] = await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, department_id, course, year_of_study) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [full_name.trim(), email.trim().toLowerCase(), hash, role, department_id || null, course || null, year_of_study || null]);
    await audit(req.user.id, 'CREATE_USER', r.insertId, { email, role });
    res.status(201).json({ user_id: r.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create the user.' });
  }
});

// PATCH /api/users/:id   body: { role?, is_active? }
router.patch('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { role, is_active } = req.body;
    const sets = [], p = [];
    if (role !== undefined) {
      if (!ROLES.includes(role)) return res.status(400).json({ error: 'Choose a valid role.' });
      if (id === req.user.id) return res.status(400).json({ error: 'You cannot change your own role.' });
      sets.push('role = ?'); p.push(role);
    }
    if (is_active !== undefined) {
      if (id === req.user.id) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
      sets.push('is_active = ?'); p.push(is_active ? 1 : 0);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to change.' });
    const [r] = await db.query(`UPDATE users SET ${sets.join(', ')} WHERE user_id = ?`, [...p, id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'User not found.' });
    await audit(req.user.id, 'UPDATE_USER', id, { role, is_active });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update the user.' });
  }
});

// POST /api/users/:id/reset-password   body: { password }
router.post('/:id/reset-password', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const hash = await bcrypt.hash(password, 10);
    const [r] = await db.query('UPDATE users SET password_hash = ? WHERE user_id = ?', [hash, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'User not found.' });
    await audit(req.user.id, 'RESET_PASSWORD', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not reset the password.' });
  }
});

module.exports = router;
