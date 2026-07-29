/**
 * One-shot local admin seed for Epic/API development.
 * Usage (from server/): node scripts/seed-local-admin.mjs
 *
 * Creates org "Local Dev Center" and an admin user if they do not already exist.
 * Credentials come from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (optional).
 * The password is NEVER written to stdout/logs (CodeQL / HIPAA logging hygiene).
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

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
const NAME = process.env.SEED_ADMIN_NAME || 'Local Admin';
const passwordFromEnv = !!(process.env.SEED_ADMIN_PASSWORD && process.env.SEED_ADMIN_PASSWORD.length >= 12);
// Prefer an explicit operator-supplied secret. If absent, generate a one-shot
// token and write it ONLY to a local mode-0600 file — never to stdout.
const PLAIN = passwordFromEnv
  ? process.env.SEED_ADMIN_PASSWORD
  : crypto.randomBytes(18).toString('base64url');

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

    let tokenFile = null;
    if (!passwordFromEnv) {
      tokenFile = path.join(__dirname, '..', '.seed-admin-password');
      fs.writeFileSync(
        tokenFile,
        `# TransTrack local admin seed token — delete after first login\n` +
          `# Account: ${EMAIL}\n` +
          `# Generated: ${new Date().toISOString()}\n\n` +
          `${PLAIN}\n`,
        { mode: 0o600 }
      );
      try { fs.chmodSync(tokenFile, 0o600); } catch { /* windows */ }
    }

    console.log('Seeded local admin:');
    console.log(`  Email: ${EMAIL}`);
    console.log(`  Org:   Local Dev Center (${orgId})`);
    if (passwordFromEnv) {
      console.log('  Password: (from SEED_ADMIN_PASSWORD — not printed)');
    } else {
      console.log(`  Password: (written to ${tokenFile} — not printed; delete after login)`);
    }
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
