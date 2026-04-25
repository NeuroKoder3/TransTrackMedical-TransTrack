#!/usr/bin/env node
'use strict';

/**
 * Lightweight, dependency-free migration runner.
 * - Reads .sql files from server/src/db/migrations/
 * - Applies any not yet recorded in schema_migrations
 * - Idempotent; safe to run on every deploy
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function getEnv() {
  // Best-effort .env loader (no external dep)
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
      }
    }
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      checksum TEXT
    )
  `);
}

function listMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
}

async function applied(client) {
  const r = await client.query('SELECT version FROM schema_migrations ORDER BY version');
  return new Set(r.rows.map(row => row.version));
}

async function up() {
  getEnv();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await ensureTable(client);
    const done = await applied(client);
    const all = listMigrations();
    let count = 0;
    for (const file of all) {
      const version = file.replace(/\.sql$/, '');
      if (done.has(version)) continue;
      process.stdout.write(`Applying ${file} ... `);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
        process.stdout.write('OK\n');
        count++;
      } catch (e) {
        await client.query('ROLLBACK');
        process.stderr.write(`FAILED\n${e.message}\n`);
        throw e;
      }
    }
    console.log(`Done. ${count} migration(s) applied; ${all.length - count} already at head.`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function status() {
  getEnv();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await ensureTable(client);
    const done = await applied(client);
    const all = listMigrations();
    for (const f of all) {
      const v = f.replace(/\.sql$/, '');
      console.log(`${done.has(v) ? '[applied]' : '[pending]'} ${v}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

async function down() {
  console.error('Down migrations are not supported — write a forward-only migration to undo.');
  process.exit(1);
}

const cmd = process.argv[2] || 'up';
const op = { up, status, down }[cmd];
if (!op) {
  console.error(`Unknown command: ${cmd}`);
  process.exit(2);
}
op().catch(e => { console.error(e); process.exit(1); });
