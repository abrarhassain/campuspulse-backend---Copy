const jwt = require('jsonwebtoken');
const db = require('../db');

// Checks the login token, then confirms the account is still active.
// The role is read from the database, so role changes and deactivation take effect at once.
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please log in first.' });
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Your login has expired. Please log in again.' });
  }
  try {
    const [rows] = await db.query('SELECT user_id, full_name, role, is_active FROM users WHERE user_id = ?', [payload.id]);
    const u = rows[0];
    if (!u || !u.is_active) return res.status(401).json({ error: 'This account is not active. Contact the admin.' });
    req.user = { id: u.user_id, role: u.role, name: u.full_name };
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
}

// Allows only certain roles, e.g. requireRole('admin', 'faculty')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do this.' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
