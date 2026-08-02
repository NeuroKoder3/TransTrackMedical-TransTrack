/**
 * Test harness for exercising Fastify route plugins without a live Fastify
 * instance or a PostgreSQL server.
 *
 * `loadWithStubs` swaps CommonJS modules (typically src/db/pool.js) for test
 * doubles by seeding require.cache before the module under test is loaded,
 * so a route plugin can be registered against a fake `app` and its handlers
 * invoked directly with a fake request.
 */

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Drop every already-loaded server module so stubs cannot be bypassed. */
function purgeServerModules() {
  const srcDir = path.join(SERVER_ROOT, 'src') + path.sep;
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(srcDir)) delete require.cache[key];
  }
}

/**
 * Load `target` (a path relative to server/) with `stubs` installed.
 * Returns the loaded module; call `restore()` to put the cache back.
 */
export function loadWithStubs(target, stubs = {}) {
  purgeServerModules();
  for (const [relative, exports] of Object.entries(stubs)) {
    const resolved = require.resolve(path.join(SERVER_ROOT, relative));
    require.cache[resolved] = {
      id: resolved,
      filename: resolved,
      path: path.dirname(resolved),
      loaded: true,
      children: [],
      paths: [],
      exports,
    };
  }
  return require(path.join(SERVER_ROOT, target));
}

export function restoreModules() {
  purgeServerModules();
}

/** Collects the routes a plugin registers so handlers can be called directly. */
export function fakeApp() {
  const routes = new Map();
  const noop = () => {};
  const log = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, trace: noop };
  const add = (method) => (url, optsOrHandler, maybeHandler) => {
    const handler = maybeHandler || optsOrHandler;
    const opts = maybeHandler ? optsOrHandler : {};
    routes.set(`${method} ${url}`, { handler, opts });
  };
  return {
    log,
    routes,
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    patch: add('PATCH'),
    delete: add('DELETE'),
    addHook: noop,
    register: noop,
    route(key) {
      const found = routes.get(key);
      if (!found) throw new Error(`route not registered: ${key} (have: ${[...routes.keys()].join(', ')})`);
      return found;
    },
    /** Run a route's preHandler chain then its handler. */
    async call(key, req, reply) {
      const { handler, opts } = this.route(key);
      const pre = Array.isArray(opts.preHandler) ? opts.preHandler
        : opts.preHandler ? [opts.preHandler] : [];
      for (const hook of pre) await hook(req, reply);
      return handler(req, reply);
    },
  };
}

export function fakeReply() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    code(c) { this.statusCode = c; return this; },
    type(t) { this.headers['content-type'] = t; return this; },
    header(k, v) { this.headers[k] = v; return this; },
    send(b) { this.body = b; return this; },
  };
}

/** Minimal pg client double: records queries, answers via a handler. */
export function fakeClient(handler) {
  return {
    queries: [],
    async query(text, values) {
      this.queries.push({ text, values });
      const rows = typeof handler === 'function' ? handler(text, values) : (handler || []);
      return { rows: rows || [], rowCount: (rows || []).length };
    },
  };
}

/** db/pool double whose transactions hand out `client`. */
export function fakePool(client) {
  return {
    init: () => null,
    getPool: () => ({ query: (text, values) => client.query(text, values) }),
    query: (text, values) => client.query(text, values),
    withTransaction: async (ctx, cb) => cb(client),
    withBillingContext: async (cb) => cb(client),
    shutdown: async () => {},
    buildSslOptions: () => false,
  };
}

export { SERVER_ROOT };
