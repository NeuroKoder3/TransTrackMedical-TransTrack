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

/**
 * Automatic logoff on inactivity — HIPAA Security Rule §164.312(a)(2)(iii).
 *
 * Every value the timer logic reads is held in a ref rather than in state, and
 * the subscribing effect depends only on `isAuthenticated`. That is load-bearing,
 * not stylistic: the previous implementation derived `handleActivity` from the
 * `showWarning` state and listed it as an effect dependency, so raising the
 * warning re-created the callback, re-ran the effect, tore down the timers and
 * called resetTimers() again. The warning was visible for a single commit and
 * the logoff timer was re-armed before it could fire, so automatic logoff never
 * happened at all. State is now write-only from the timers' point of view.
 */
export default function IdleTimeoutManager() {
  const { isAuthenticated, logout } = useAuth();
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const lastActivityRef = useRef(Date.now());
  const warningTimerRef = useRef(null);
  const logoutTimerRef = useRef(null);
  const countdownRef = useRef(null);
  // Mirrors showWarning so the activity throttle can read it without making
  // the timer logic depend on a state value.
  const showWarningRef = useRef(false);

  // AuthContext does not memoize logout, so it is read through a ref to keep
  // every callback below stable across renders.
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  const setWarning = useCallback((value) => {
    showWarningRef.current = value;
    setShowWarning(value);
  }, []);

  const clearAllTimers = useCallback(() => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    warningTimerRef.current = null;
    logoutTimerRef.current = null;
    countdownRef.current = null;
  }, []);

  const resetTimers = useCallback(() => {
    lastActivityRef.current = Date.now();
    setWarning(false);
    clearAllTimers();

    warningTimerRef.current = setTimeout(() => {
      const remaining = Math.ceil(
        (IDLE_TIMEOUT_MS - (Date.now() - lastActivityRef.current)) / 1000
      );
      setSecondsLeft(remaining > 0 ? remaining : Math.ceil(WARNING_BEFORE_MS / 1000));
      setWarning(true);

      countdownRef.current = setInterval(() => {
        const left = Math.max(
          0,
          Math.ceil((lastActivityRef.current + IDLE_TIMEOUT_MS - Date.now()) / 1000)
        );
        setSecondsLeft(left);
        if (left <= 0 && countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
      }, 1000);
    }, Math.max(0, IDLE_TIMEOUT_MS - WARNING_BEFORE_MS));

    logoutTimerRef.current = setTimeout(() => {
      clearAllTimers();
      logoutRef.current(true);
    }, IDLE_TIMEOUT_MS);
  }, [setWarning, clearAllTimers]);

  const handleExtendSession = useCallback(() => {
    resetTimers();
    if (window.electronAPI?.auth?.isAuthenticated) {
      window.electronAPI.auth.isAuthenticated().catch(() => {});
    }
  }, [resetTimers]);

  // The OS reported a screen lock or suspend. The main process has already
  // ended the session, so this only clears PHI from the screen and returns to
  // the login view — otherwise the last-rendered patient data would still be on
  // display the moment the workstation is unlocked.
  useEffect(() => {
    const subscribe = window.electronAPI?.session?.onLocked;
    if (typeof subscribe !== 'function') return undefined;

    return subscribe(() => {
      setWarning(false);
      logoutRef.current(true);
    });
  }, [setWarning]);

  useEffect(() => {
    if (!isAuthenticated) {
      clearAllTimers();
      setWarning(false);
      return undefined;
    }

    // Read through refs so that raising the warning cannot re-run this effect.
    const onActivity = () => {
      const now = Date.now();
      // While the warning is up, any activity should extend the session
      // immediately rather than waiting out the throttle window.
      if (now - lastActivityRef.current < THROTTLE_MS && !showWarningRef.current) return;
      resetTimers();
    };

    resetTimers();
    ACTIVITY_EVENTS.forEach((event) => {
      window.addEventListener(event, onActivity, { passive: true });
    });

    return () => {
      ACTIVITY_EVENTS.forEach((event) => {
        window.removeEventListener(event, onActivity);
      });
      clearAllTimers();
    };
  }, [isAuthenticated, resetTimers, clearAllTimers, setWarning]);

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
          <AlertDialogCancel onClick={() => logoutRef.current(true)}>
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
