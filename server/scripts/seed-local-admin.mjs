/**
 * One-shot local admin seed for Epic/API development.
 * Usage (from server/): node scripts/seed-local-admin.mjs
 *
 * Creates org "Local Dev Center" and admin@transtrack.local / ChangeMeNow!123456
 * if they do not already exist.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load server/.env without adding a dotenv dependency.
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const { Pool } = require('pg');
const password = require('../src/auth/password');

const EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@transtrack.local';
const PLAIN = process.env.SEED_ADMIN_PASSWORD || 'ChangeMeNow!123456';
const NAME = process.env.SEED_ADMIN_NAME || 'Local Admin';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const existing = await client.query(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [EMAIL]
    );
    if (existing.rows[0]) {
      console.log(`User already exists: ${EMAIL}`);
      console.log('Password unchanged. Use that account to log in.');
      return;
    }

    await client.query('BEGIN');
    const org = await client.query(
      `INSERT INTO organizations (name, type)
       VALUES ('Local Dev Center', 'TRANSPLANT_CENTER')
       RETURNING id`
    );
    const orgId = org.rows[0].id;
    const hash = await password.hash(PLAIN);
    await client.query(
      `INSERT INTO users (org_id, email, password_hash, full_name, role, auth_provider, is_active)
       VALUES ($1, $2, $3, $4, 'admin', 'local', TRUE)`,
      [orgId, EMAIL, hash, NAME]
    );
    await client.query('COMMIT');
    console.log('Seeded local admin:');
    console.log(`  Email:    ${EMAIL}`);
    console.log(`  Password: ${PLAIN}`);
    console.log(`  Org:      Local Dev Center (${orgId})`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
