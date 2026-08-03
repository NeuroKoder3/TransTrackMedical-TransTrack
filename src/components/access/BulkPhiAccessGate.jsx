import { useCallback, useEffect, useRef, useState } from 'react';
import JustificationDialog from '@/components/access/JustificationDialog';
import {
  setBulkPhiGrantHandler,
  BULK_PHI_PERMISSION,
  BULK_PHI_SCOPE_ID,
} from '@/lib/phiAccessBroker';

/**
 * App-level gate that services bulk PHI justification requests (H-1).
 *
 * Mounted once inside the authenticated tree. The API client raises a request
 * through the broker when the main process refuses a bulk patient read for want
 * of a list-scope grant; this component collects the justification, calls
 * access:authorizePhiAccess, and reports whether a grant was issued so the
 * client can retry.
 *
 * The main process is the authority: it re-checks the permission, enforces the
 * justification minimum length, and writes the justification log before any row
 * is returned. This component only collects the text.
 */
export default function BulkPhiAccessGate() {
  const [request, setRequest] = useState(null);
  const resolveRef = useRef(null);

  useEffect(() => {
    return setBulkPhiGrantHandler((entityType) =>
      new Promise((resolve) => {
        resolveRef.current = resolve;
        setRequest({ entityType });
      })
    );
  }, []);

  const settle = useCallback((granted) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setRequest(null);
    if (resolve) resolve(granted);
  }, []);

  const handleConfirm = useCallback(async (justification) => {
    const text = typeof justification === 'string'
      ? justification
      : justification?.details || justification?.reason || '';
    try {
      const authorize = window.electronAPI?.accessControl?.authorizePhiAccess;
      if (!authorize) {
        // No bridge means no main process to grant against; refuse rather than
        // assume access, so a broken bridge cannot open bulk PHI.
        settle(false);
        return;
      }
      const result = await authorize({
        permission: BULK_PHI_PERMISSION,
        entityType: request?.entityType || 'Patient',
        entityId: BULK_PHI_SCOPE_ID,
        justification: text,
      });
      settle(!!result?.granted);
    } catch {
      settle(false);
    }
  }, [request, settle]);

  const handleCancel = useCallback(() => settle(false), [settle]);

  if (!request) return null;

  return (
    <JustificationDialog
      open
      entityType={request.entityType}
      action="view the full patient list"
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );
}
