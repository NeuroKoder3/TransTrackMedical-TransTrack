/**
 * BarrierStatusBadge Component
 * 
 * Displays a badge for readiness barrier status and risk level.
 * 
 * NOTE: Readiness barriers are NON-CLINICAL, NON-ALLOCATIVE operational
 * tracking items only. They do not affect allocation decisions or replace
 * UNOS/OPTN systems.
 */

import React from 'react';
import { 
  AlertTriangle, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  CircleDot
} from 'lucide-react';

// Status badge configurations
const STATUS_CONFIG = {
  open: {
    label: 'Open',
    color: 'bg-red-500',
    textColor: 'text-red-700',
    bgLight: 'bg-red-50',
    borderColor: 'border-red-200',
    icon: AlertCircle,
  },
  in_progress: {
    label: 'In Progress',
    color: 'bg-amber-500',
    textColor: 'text-amber-700',
    bgLight: 'bg-amber-50',
    borderColor: 'border-amber-200',
    icon: Clock,
  },
  resolved: {
    label: 'Resolved',
    color: 'bg-green-500',
    textColor: 'text-green-700',
    bgLight: 'bg-green-50',
    borderColor: 'border-green-200',
    icon: CheckCircle2,
  },
};

// Risk level badge configurations
const RISK_CONFIG = {
  high: {
    label: 'High Risk',
    color: 'bg-red-500',
    textColor: 'text-red-700',
    bgLight: 'bg-red-50',
    borderColor: 'border-red-200',
    icon: AlertTriangle,
  },
  moderate: {
    label: 'Moderate',
    color: 'bg-amber-500',
    textColor: 'text-amber-700',
    bgLight: 'bg-amber-50',
    borderColor: 'border-amber-200',
    icon: AlertCircle,
  },
  low: {
    label: 'Low',
    color: 'bg-blue-500',
    textColor: 'text-blue-700',
    bgLight: 'bg-blue-50',
    borderColor: 'border-blue-200',
    icon: CircleDot,
  },
  none: {
    label: 'None',
    color: 'bg-slate-500',
    textColor: 'text-slate-700',
    bgLight: 'bg-slate-50',
    borderColor: 'border-slate-200',
    icon: CheckCircle2,
  },
};

export function BarrierStatusBadge({ status, size = 'md' }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.open;
  const Icon = config.icon;

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5',
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  return (
    <span 
      className={`inline-flex items-center gap-1.5 ${config.bgLight} ${config.borderColor} border rounded-full ${sizeClasses[size]} font-medium ${config.textColor}`}
    >
      <Icon className={iconSizes[size]} />
      <span>{config.label}</span>
    </span>
  );
}

export function BarrierRiskBadge({ riskLevel, size = 'md' }) {
  const config = RISK_CONFIG[riskLevel] || RISK_CONFIG.low;
  const Icon = config.icon;

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5',
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  return (
    <span 
      className={`inline-flex items-center gap-1.5 ${config.bgLight} ${config.borderColor} border rounded-full ${sizeClasses[size]} font-medium ${config.textColor}`}
    >
      <Icon className={iconSizes[size]} />
      <span>{config.label}</span>
    </span>
  );
}

export function BarrierCountBadge({ count, highRiskCount = 0, size = 'md' }) {
  if (count === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 bg-green-50 border-green-200 border rounded-full text-sm px-2.5 py-1 font-medium text-green-700">
        <CheckCircle2 className="w-4 h-4" />
        <span>No barriers</span>
      </span>
    );
  }

  const hasHighRisk = highRiskCount > 0;
  const bgColor = hasHighRisk ? 'bg-red-50' : 'bg-amber-50';
  const borderColor = hasHighRisk ? 'border-red-200' : 'border-amber-200';
  const textColor = hasHighRisk ? 'text-red-700' : 'text-amber-700';

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5',
  };

  return (
    <span 
      className={`inline-flex items-center gap-1.5 ${bgColor} ${borderColor} border rounded-full ${sizeClasses[size]} font-medium ${textColor}`}
    >
      <AlertTriangle className="w-4 h-4" />
      <span>
        {count} barrier{count !== 1 ? 's' : ''}
        {highRiskCount > 0 && ` (${highRiskCount} high-risk)`}
      </span>
    </span>
  );
}

export default BarrierStatusBadge;
