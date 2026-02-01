/**
 * LabStatusBadge Component
 * 
 * Displays status badges for lab documentation tracking.
 * 
 * IMPORTANT DISCLAIMER:
 * This shows DOCUMENTATION status only (missing/expired/current).
 * It does NOT interpret lab values or provide clinical assessments.
 */

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, Clock, AlertTriangle, FileX } from 'lucide-react';

/**
 * Badge showing lab documentation status (CURRENT, EXPIRED, MISSING)
 */
export function LabDocStatusBadge({ status, size = 'md' }) {
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-0.5',
    lg: 'text-base px-3 py-1',
  };
  
  const configs = {
    CURRENT: {
      className: 'bg-green-100 text-green-700 border-green-200',
      icon: CheckCircle,
      label: 'Current',
    },
    EXPIRED: {
      className: 'bg-amber-100 text-amber-700 border-amber-200',
      icon: Clock,
      label: 'Expired',
    },
    MISSING: {
      className: 'bg-red-100 text-red-700 border-red-200',
      icon: FileX,
      label: 'Missing',
    },
  };
  
  const config = configs[status] || configs.MISSING;
  const Icon = config.icon;
  
  return (
    <Badge variant="outline" className={`${config.className} ${sizeClasses[size]} font-medium`}>
      <Icon className={`${size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} mr-1`} />
      {config.label}
    </Badge>
  );
}

/**
 * Badge showing documentation risk level
 * NOTE: This is DOCUMENTATION risk, not clinical risk
 */
export function LabRiskBadge({ riskLevel, size = 'md' }) {
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-0.5',
    lg: 'text-base px-3 py-1',
  };
  
  const configs = {
    high: {
      className: 'bg-red-100 text-red-700 border-red-200',
      label: 'High',
    },
    medium: {
      className: 'bg-amber-100 text-amber-700 border-amber-200',
      label: 'Medium',
    },
    low: {
      className: 'bg-green-100 text-green-700 border-green-200',
      label: 'Low',
    },
  };
  
  const config = configs[riskLevel] || configs.low;
  
  return (
    <Badge variant="outline" className={`${config.className} ${sizeClasses[size]} font-medium`}>
      {config.label}
    </Badge>
  );
}

/**
 * Badge showing source of lab data (MANUAL or FHIR_IMPORT)
 */
export function LabSourceBadge({ source, size = 'sm' }) {
  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-xs px-2 py-0.5',
  };
  
  const configs = {
    MANUAL: {
      className: 'bg-slate-100 text-slate-600 border-slate-200',
      label: 'Manual',
    },
    FHIR_IMPORT: {
      className: 'bg-blue-100 text-blue-600 border-blue-200',
      label: 'FHIR',
    },
  };
  
  const config = configs[source] || configs.MANUAL;
  
  return (
    <Badge variant="outline" className={`${config.className} ${sizeClasses[size]}`}>
      {config.label}
    </Badge>
  );
}

/**
 * Summary badge showing lab counts
 */
export function LabCountBadge({ current = 0, expired = 0, missing = 0, size = 'md' }) {
  const total = current + expired + missing;
  const hasIssues = expired > 0 || missing > 0;
  
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-0.5',
  };
  
  if (total === 0) {
    return (
      <Badge variant="outline" className={`bg-slate-100 text-slate-600 ${sizeClasses[size]}`}>
        No labs
      </Badge>
    );
  }
  
  if (!hasIssues) {
    return (
      <Badge variant="outline" className={`bg-green-100 text-green-700 ${sizeClasses[size]}`}>
        <CheckCircle className={`${size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} mr-1`} />
        {current} current
      </Badge>
    );
  }
  
  return (
    <Badge variant="outline" className={`bg-amber-100 text-amber-700 ${sizeClasses[size]}`}>
      <AlertTriangle className={`${size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} mr-1`} />
      {expired > 0 && `${expired} expired`}
      {expired > 0 && missing > 0 && ', '}
      {missing > 0 && `${missing} missing`}
    </Badge>
  );
}

export default LabDocStatusBadge;
