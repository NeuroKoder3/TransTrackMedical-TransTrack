/**
 * AHHQStatusBadge Component
 * 
 * Displays the status of an Adult Health History Questionnaire (aHHQ)
 * with appropriate color coding and icons.
 * 
 * NOTE: This component is for OPERATIONAL DOCUMENTATION tracking only.
 * It does NOT display medical information or clinical assessments.
 */

import React from 'react';
import { 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  XCircle,
  FileWarning,
  FileCheck,
  FileX
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Status configuration
const STATUS_CONFIG = {
  complete: {
    label: 'Complete',
    color: 'bg-green-100 text-green-800 border-green-300',
    icon: CheckCircle2,
    description: 'aHHQ is complete and current',
  },
  incomplete: {
    label: 'Incomplete',
    color: 'bg-red-100 text-red-800 border-red-300',
    icon: AlertCircle,
    description: 'aHHQ has missing or incomplete sections',
  },
  pending_update: {
    label: 'Pending Update',
    color: 'bg-amber-100 text-amber-800 border-amber-300',
    icon: Clock,
    description: 'aHHQ requires review and update',
  },
  expired: {
    label: 'Expired',
    color: 'bg-red-100 text-red-800 border-red-300',
    icon: XCircle,
    description: 'aHHQ has expired and needs renewal',
  },
};

// Expiration status configuration
const EXPIRATION_CONFIG = {
  expiring: {
    label: 'Expiring Soon',
    color: 'bg-amber-100 text-amber-800 border-amber-300',
    icon: Clock,
  },
  expired: {
    label: 'Expired',
    color: 'bg-red-100 text-red-800 border-red-300',
    icon: XCircle,
  },
  current: {
    label: 'Current',
    color: 'bg-green-100 text-green-800 border-green-300',
    icon: CheckCircle2,
  },
};

/**
 * Status badge for aHHQ status
 */
export function AHHQStatusBadge({ status, showTooltip = true, size = 'default' }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.incomplete;
  const Icon = config.icon;
  
  const sizeClasses = size === 'small' 
    ? 'text-xs px-2 py-0.5' 
    : 'text-sm px-2.5 py-1';

  const badge = (
    <Badge 
      variant="outline" 
      className={`${config.color} ${sizeClasses} flex items-center gap-1`}
    >
      <Icon className={size === 'small' ? 'w-3 h-3' : 'w-4 h-4'} />
      <span>{config.label}</span>
    </Badge>
  );

  if (!showTooltip) return badge;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent>
          <p>{config.description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Expiration badge for aHHQ
 */
export function AHHQExpirationBadge({ daysUntilExpiration, isExpired, isExpiringSoon, size = 'default' }) {
  let config;
  let label;
  
  if (isExpired) {
    config = EXPIRATION_CONFIG.expired;
    label = 'Expired';
  } else if (isExpiringSoon) {
    config = EXPIRATION_CONFIG.expiring;
    label = daysUntilExpiration !== null ? `${daysUntilExpiration}d left` : 'Expiring';
  } else {
    config = EXPIRATION_CONFIG.current;
    label = daysUntilExpiration !== null ? `${daysUntilExpiration}d` : 'Current';
  }
  
  const Icon = config.icon;
  const sizeClasses = size === 'small' 
    ? 'text-xs px-2 py-0.5' 
    : 'text-sm px-2.5 py-1';

  return (
    <Badge 
      variant="outline" 
      className={`${config.color} ${sizeClasses} flex items-center gap-1`}
    >
      <Icon className={size === 'small' ? 'w-3 h-3' : 'w-4 h-4'} />
      <span>{label}</span>
    </Badge>
  );
}

/**
 * Risk badge for aHHQ issues
 */
export function AHHQRiskBadge({ issueType, size = 'default' }) {
  const configs = {
    missing: {
      label: 'aHHQ Missing',
      color: 'bg-red-100 text-red-800 border-red-300',
      icon: FileX,
    },
    expired: {
      label: 'aHHQ Expired',
      color: 'bg-red-100 text-red-800 border-red-300',
      icon: XCircle,
    },
    expiring: {
      label: 'aHHQ Expiring',
      color: 'bg-amber-100 text-amber-800 border-amber-300',
      icon: Clock,
    },
    incomplete: {
      label: 'aHHQ Incomplete',
      color: 'bg-amber-100 text-amber-800 border-amber-300',
      icon: FileWarning,
    },
    ok: {
      label: 'aHHQ Current',
      color: 'bg-green-100 text-green-800 border-green-300',
      icon: FileCheck,
    },
  };
  
  const config = configs[issueType] || configs.incomplete;
  const Icon = config.icon;
  
  const sizeClasses = size === 'small' 
    ? 'text-xs px-2 py-0.5' 
    : 'text-sm px-2.5 py-1';

  return (
    <Badge 
      variant="outline" 
      className={`${config.color} ${sizeClasses} flex items-center gap-1`}
    >
      <Icon className={size === 'small' ? 'w-3 h-3' : 'w-4 h-4'} />
      <span>{config.label}</span>
    </Badge>
  );
}

export default AHHQStatusBadge;
