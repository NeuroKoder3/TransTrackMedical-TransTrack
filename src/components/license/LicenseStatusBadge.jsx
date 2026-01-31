/**
 * LicenseStatusBadge Component
 * 
 * Displays the current license status in a compact badge format.
 * Shows tier, evaluation status, and warnings.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  Shield, 
  Clock, 
  AlertTriangle,
  Crown,
  Star
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const TIER_CONFIG = {
  evaluation: {
    label: 'Evaluation',
    color: 'bg-amber-100 text-amber-800 border-amber-300',
    icon: Clock,
    description: '14-day trial period',
  },
  starter: {
    label: 'Starter',
    color: 'bg-blue-100 text-blue-800 border-blue-300',
    icon: Shield,
    description: 'Single workstation license',
  },
  professional: {
    label: 'Professional',
    color: 'bg-purple-100 text-purple-800 border-purple-300',
    icon: Star,
    description: 'Up to 5 workstations',
  },
  enterprise: {
    label: 'Enterprise',
    color: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    icon: Crown,
    description: 'Unlimited workstations',
  },
};

export default function LicenseStatusBadge({ showTooltip = true, size = 'default' }) {
  const { data: licenseInfo, isLoading } = useQuery({
    queryKey: ['licenseInfo'],
    queryFn: async () => {
      if (window.electronAPI?.license) {
        return await window.electronAPI.license.getInfo();
      }
      return null;
    },
    staleTime: 60000, // Cache for 1 minute
  });

  if (isLoading || !licenseInfo) {
    return (
      <Badge variant="outline" className="animate-pulse">
        <Shield className="w-3 h-3 mr-1" />
        Loading...
      </Badge>
    );
  }

  const tier = licenseInfo.tier || 'evaluation';
  const config = TIER_CONFIG[tier] || TIER_CONFIG.evaluation;
  const Icon = config.icon;

  // Determine status
  let statusText = config.label;
  let statusColor = config.color;
  let showWarning = false;
  let warningText = '';

  if (licenseInfo.isEvaluation) {
    if (licenseInfo.evaluationExpired) {
      statusText = 'Expired';
      statusColor = 'bg-red-100 text-red-800 border-red-300';
      showWarning = true;
      warningText = 'Evaluation period has expired';
    } else if (licenseInfo.evaluationDaysRemaining <= 3) {
      showWarning = true;
      warningText = `${licenseInfo.evaluationDaysRemaining} day(s) remaining`;
    } else {
      statusText = `${licenseInfo.evaluationDaysRemaining} days left`;
    }
  } else if (licenseInfo.maintenance?.expired) {
    showWarning = true;
    warningText = 'Maintenance expired - updates disabled';
  } else if (licenseInfo.maintenance?.showWarning) {
    showWarning = true;
    warningText = `Maintenance expires in ${licenseInfo.maintenance.daysRemaining} days`;
  }

  const sizeClasses = size === 'small' 
    ? 'text-xs px-2 py-0.5' 
    : 'text-sm px-2.5 py-1';

  const badge = (
    <Badge 
      variant="outline" 
      className={`${statusColor} ${sizeClasses} flex items-center gap-1 cursor-default`}
    >
      {showWarning ? (
        <AlertTriangle className={size === 'small' ? 'w-3 h-3' : 'w-4 h-4'} />
      ) : (
        <Icon className={size === 'small' ? 'w-3 h-3' : 'w-4 h-4'} />
      )}
      <span>{statusText}</span>
    </Badge>
  );

  if (!showTooltip) {
    return badge;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {badge}
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1">
            <p className="font-medium">{config.label} License</p>
            <p className="text-xs text-slate-500">{config.description}</p>
            {showWarning && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {warningText}
              </p>
            )}
            {licenseInfo.orgName && (
              <p className="text-xs text-slate-400">Org: {licenseInfo.orgName}</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
