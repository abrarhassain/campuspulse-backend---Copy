// Gives every user in the database one password (stored as a bcrypt hash).
// Local demo:   npm run setup                         -> password123
// Real site:    node setup-passwords.js "StrongPass1" -> your own password
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const password = process.argv[2] || 'password123';
if (password.length < 8) { console.error('Use a password with at least 8 characters.'); process.exit(1); }

(async () => {
  const hash = await bcrypt.hash(password, 10);
  const [r] = await db.query('UPDATE users SET password_hash = ?', [hash]);
  console.log(`Done. ${r.affectedRows} user(s) now have the password you chose.`);
  process.exit(0);
})().catch(e => { console.error('Failed:', e.message); process.exit(1); });
