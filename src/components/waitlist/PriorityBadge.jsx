import React from 'react';
import { AlertCircle, TrendingUp, Minus, TrendingDown } from 'lucide-react';

export default function PriorityBadge({ score, size = 'md', showLabel = true }) {
  const getConfig = () => {
    if (score >= 80) {
      return {
        label: 'Critical',
        color: 'bg-red-500',
        textColor: 'text-red-700',
        bgLight: 'bg-red-50',
        borderColor: 'border-red-200',
        icon: AlertCircle,
      };
    } else if (score >= 60) {
      return {
        label: 'High',
        color: 'bg-orange-500',
        textColor: 'text-orange-700',
        bgLight: 'bg-orange-50',
        borderColor: 'border-orange-200',
        icon: TrendingUp,
      };
    } else if (score >= 40) {
      return {
        label: 'Medium',
        color: 'bg-amber-500',
        textColor: 'text-amber-700',
        bgLight: 'bg-amber-50',
        borderColor: 'border-amber-200',
        icon: Minus,
      };
    } else {
      return {
        label: 'Low',
        color: 'bg-slate-500',
        textColor: 'text-slate-700',
        bgLight: 'bg-slate-50',
        borderColor: 'border-slate-200',
        icon: TrendingDown,
      };
    }
  };

  const config = getConfig();
  const Icon = config.icon;

  const sizeClasses = {
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-1.5',
    lg: 'text-base px-4 py-2',
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  if (!showLabel) {
    return (
      <div className={`flex items-center justify-center ${config.bgLight} ${config.borderColor} border rounded-lg p-2`}>
        <Icon className={`${iconSizes[size]} ${config.textColor}`} />
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center space-x-2 ${config.bgLight} ${config.borderColor} border rounded-lg ${sizeClasses[size]} font-medium ${config.textColor}`}>
      <Icon className={iconSizes[size]} />
      <span>{config.label}</span>
      <span className="font-bold">{Math.round(score)}</span>
    </div>
  );
}