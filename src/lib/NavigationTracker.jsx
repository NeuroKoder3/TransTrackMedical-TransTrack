import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * NavigationTracker — records in-session page navigation for support triage.
 *
 * This is NOT the audit trail. The authoritative, tamper-evident audit trail is
 * the hash-chained `audit_logs` table in the main process; this is a
 * session-scoped breadcrumb list only, and it is purged on logout by
 * purgeClientPhiCaches().
 *
 * Route parameters are stripped before storage. A path such as
 * /PatientDetails/8f3c… identifies a patient, so storing raw paths would put a
 * record identifier into sessionStorage where nothing governs its lifetime.
 */

/** Anything that looks like a record identifier is replaced with a placeholder. */
const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-9a-f]{16,})$/i;

export function redactRoutePath(pathname) {
  return String(pathname || '')
    .split('/')
    .map((segment) => (ID_SEGMENT.test(segment) ? ':id' : segment))
    .join('/');
}

const MAX_ENTRIES = 100;

export default function NavigationTracker() {
  const location = useLocation();

  useEffect(() => {
    try {
      const history = JSON.parse(sessionStorage.getItem('navHistory') || '[]');
      history.push({
        path: redactRoutePath(location.pathname),
        timestamp: new Date().toISOString(),
      });
      while (history.length > MAX_ENTRIES) history.shift();
      sessionStorage.setItem('navHistory', JSON.stringify(history));
    } catch {
      // sessionStorage may be unavailable; the breadcrumb list is optional.
    }
  }, [location]);

  return null;
}
