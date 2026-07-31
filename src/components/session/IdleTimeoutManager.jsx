import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/AuthContext';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';

const _policy = typeof window !== 'undefined' && window.transtrackConfig?.securityPolicy;
const IDLE_TIMEOUT_MS = _policy?.IDLE_TIMEOUT_MS || 15 * 60 * 1000;
const WARNING_BEFORE_MS = _policy?.WARNING_BEFORE_MS || 2 * 60 * 1000;
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'];
const THROTTLE_MS = 30000;

export default function IdleTimeoutManager() {
  const { isAuthenticated, logout } = useAuth();
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const lastActivityRef = useRef(Date.now());
  const warningTimerRef = useRef(null);
  const logoutTimerRef = useRef(null);
  const countdownRef = useRef(null);

  const resetTimers = useCallback(() => {
    lastActivityRef.current = Date.now();
    setShowWarning(false);

    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    warningTimerRef.current = setTimeout(() => {
      const remaining = Math.ceil((IDLE_TIMEOUT_MS - (Date.now() - lastActivityRef.current)) / 1000);
      setSecondsLeft(remaining > 0 ? remaining : Math.ceil(WARNING_BEFORE_MS / 1000));
      setShowWarning(true);

      countdownRef.current = setInterval(() => {
        const now = Date.now();
        const left = Math.max(0, Math.ceil((lastActivityRef.current + IDLE_TIMEOUT_MS - now) / 1000));
        setSecondsLeft(left);
        if (left <= 0) {
          clearInterval(countdownRef.current);
        }
      }, 1000);
    }, IDLE_TIMEOUT_MS - WARNING_BEFORE_MS);

    logoutTimerRef.current = setTimeout(() => {
      logout(true);
    }, IDLE_TIMEOUT_MS);
  }, [logout]);

  const handleActivity = useCallback(() => {
    if (!isAuthenticated) return;
    const now = Date.now();
    if (now - lastActivityRef.current < THROTTLE_MS && !showWarning) return;
    resetTimers();
  }, [isAuthenticated, showWarning, resetTimers]);

  const handleExtendSession = useCallback(() => {
    resetTimers();
    if (window.electronAPI?.auth?.isAuthenticated) {
      window.electronAPI.auth.isAuthenticated().catch(() => {});
    }
  }, [resetTimers]);

  // The OS reported a screen lock or suspend. The main process has already
  // ended the session server-side, so this only clears PHI from the screen and
  // returns to the login view — otherwise the last-rendered patient data would
  // still be on display the moment the workstation is unlocked.
  //
  // logout is read through a ref so this subscribes exactly once: AuthContext
  // does not memoize logout, so depending on it directly would tear down and
  // re-register the listener on every render.
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  useEffect(() => {
    const subscribe = window.electronAPI?.session?.onLocked;
    if (typeof subscribe !== 'function') return undefined;

    return subscribe(() => {
      setShowWarning(false);
      logoutRef.current(true);
    });
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      setShowWarning(false);
      return;
    }

    resetTimers();

    ACTIVITY_EVENTS.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    return () => {
      ACTIVITY_EVENTS.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [isAuthenticated, resetTimers, handleActivity]);

  if (!isAuthenticated || !showWarning) return null;

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return (
    <AlertDialog open={showWarning} onOpenChange={() => {}}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Session Expiring Soon</AlertDialogTitle>
          <AlertDialogDescription>
            Your session will expire in{' '}
            <span className="font-mono font-bold text-red-600">
              {minutes}:{seconds.toString().padStart(2, '0')}
            </span>{' '}
            due to inactivity. For HIPAA compliance, inactive sessions are automatically terminated to protect patient data.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => logout(true)}>
            Log Out Now
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleExtendSession}>
            Continue Session
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
