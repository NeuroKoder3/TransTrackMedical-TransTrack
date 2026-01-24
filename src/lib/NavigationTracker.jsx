import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * NavigationTracker - Tracks page navigation for analytics
 * 
 * In offline mode, this stores navigation history locally
 * for audit trail purposes.
 */
export default function NavigationTracker() {
  const location = useLocation();

  useEffect(() => {
    // Log navigation for audit purposes (stored locally)
    const timestamp = new Date().toISOString();
    const path = location.pathname;
    
    // Store in session storage for audit trail
    try {
      const history = JSON.parse(sessionStorage.getItem('navHistory') || '[]');
      history.push({ path, timestamp });
      // Keep last 100 entries
      if (history.length > 100) {
        history.shift();
      }
      sessionStorage.setItem('navHistory', JSON.stringify(history));
    } catch (e) {
      // Ignore storage errors
    }
  }, [location]);

  return null;
}
