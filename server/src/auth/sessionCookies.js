'use strict';

const REFRESH_COOKIE = 'transtrack_refresh';
const ACCESS_COOKIE = 'transtrack_access';

function cookieBase(config) {
  return {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'Lax',
  };
}

function setSessionCookies(reply, { access, refresh, config }) {
  const base = cookieBase(config);
  if (refresh) {
    reply.setCookie(REFRESH_COOKIE, refresh, {
      ...base,
      path: '/auth',
      maxAge: config.JWT_REFRESH_TTL_SECONDS,
    });
  }
  if (access) {
    reply.setCookie(ACCESS_COOKIE, access, {
      ...base,
      path: '/',
      maxAge: config.JWT_ACCESS_TTL_SECONDS,
    });
  }
}

function clearSessionCookies(reply) {
  reply.clearCookie(REFRESH_COOKIE, { path: '/auth' });
  reply.clearCookie(ACCESS_COOKIE, { path: '/' });
}

function readRefreshToken(req, bodyRefresh) {
  return bodyRefresh || req.cookies?.[REFRESH_COOKIE] || null;
}

function readAccessToken(req) {
  const header = req.headers.authorization || '';
  if (header.toLowerCase().startsWith('bearer ')) {
    const raw = header.slice(header.indexOf(' ') + 1).trim();
    if (raw) return raw;
  }
  return req.cookies?.[ACCESS_COOKIE] || null;
}

module.exports = {
  REFRESH_COOKIE,
  ACCESS_COOKIE,
  setSessionCookies,
  clearSessionCookies,
  readRefreshToken,
  readAccessToken,
};
