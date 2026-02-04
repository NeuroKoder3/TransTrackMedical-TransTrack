/**
 * TransplantClock Component
 * 
 * A visual heartbeat of the transplant program showing operational activity rhythm.
 * Provides real-time awareness for coordination teams with animated feedback.
 * 
 * Features:
 * - Live clock pulse with animated outer glow
 * - Time since last update display
 * - Average task resolution time
 * - Next expiration countdown
 * - Coordinator load indicator
 * - Status color transitions (green → yellow → red)
 * 
 * 100% computed locally from the encrypted SQLite database.
 * No cloud, API, or AI inference required.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { 
  Activity, 
  AlertCircle, 
  Calendar, 
  Users,
  TrendingUp,
  Loader2
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import api from '@/api/localClient';

// Color palette matching TransTrack UI
const COLORS = {
  surface: '#F9FAFB',
  border: '#E5E7EB',
  clockHand: '#111827',
  pulseGreen: '#10B981',
  pulseYellow: '#F59E0B',
  pulseRed: '#EF4444',
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  panelBg: '#FFFFFF',
  shadow: 'rgba(17, 24, 39, 0.08)',
};

// Get color based on status
const getStatusColors = (status) => {
  switch (status) {
    case 'green':
      return {
        glow: COLORS.pulseGreen,
        bg: 'bg-emerald-50',
        border: 'border-emerald-200',
        text: 'text-emerald-700',
        ring: 'ring-emerald-400/30',
      };
    case 'yellow':
      return {
        glow: COLORS.pulseYellow,
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        text: 'text-amber-700',
        ring: 'ring-amber-400/30',
      };
    case 'red':
      return {
        glow: COLORS.pulseRed,
        bg: 'bg-red-50',
        border: 'border-red-200',
        text: 'text-red-700',
        ring: 'ring-red-400/30',
      };
    default:
      return {
        glow: COLORS.pulseGreen,
        bg: 'bg-slate-50',
        border: 'border-slate-200',
        text: 'text-slate-700',
        ring: 'ring-slate-400/30',
      };
  }
};

// Get load level colors
const getLoadColors = (level) => {
  switch (level) {
    case 'low':
      return { bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-500' };
    case 'moderate':
      return { bg: 'bg-amber-100', text: 'text-amber-700', ring: 'ring-amber-500' };
    case 'high':
      return { bg: 'bg-orange-100', text: 'text-orange-700', ring: 'ring-orange-500' };
    case 'critical':
      return { bg: 'bg-red-100', text: 'text-red-700', ring: 'ring-red-500' };
    default:
      return { bg: 'bg-slate-100', text: 'text-slate-700', ring: 'ring-slate-500' };
  }
};

// Clock hand rotation based on hours since last update (0-24h = full rotation)
const getClockHandRotation = (hours) => {
  // One full rotation represents 24 hours
  const rotation = Math.min(hours, 24) * (360 / 24);
  return rotation;
};

// Format hours display
const formatHours = (hours) => {
  if (hours === null || hours === undefined) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${Math.round(hours % 24)}h`;
};

export default function TransplantClock({ compact = false }) {
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // Update current time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  
  // Fetch clock data
  const { data: clockData, isLoading, error } = useQuery({
    queryKey: ['transplantClock'],
    queryFn: async () => {
      if (window.electronAPI?.clock) {
        return await window.electronAPI.clock.getData();
      }
      return await api.clock.getData();
    },
    refetchInterval: 5000, // Refresh every 5 seconds for real-time feel
    staleTime: 3000,
  });
  
  // Calculate derived values
  const statusColors = useMemo(() => 
    getStatusColors(clockData?.statusColor || 'green'), 
    [clockData?.statusColor]
  );
  
  const loadColors = useMemo(() => 
    getLoadColors(clockData?.coordinatorLoad?.level || 'low'),
    [clockData?.coordinatorLoad?.level]
  );
  
  const clockHandRotation = useMemo(() => 
    getClockHandRotation(clockData?.timeSinceLastUpdate?.hours || 0),
    [clockData?.timeSinceLastUpdate?.hours]
  );
  
  // Calculate pulse animation duration based on pulse rate
  const pulseDuration = useMemo(() => {
    if (!clockData?.pulseRate || clockData.pulseRate <= 0) return 2;
    return Math.max(0.3, 1 / clockData.pulseRate);
  }, [clockData?.pulseRate]);
  
  if (isLoading) {
    return (
      <Card className={`${compact ? 'w-[220px]' : 'w-full max-w-xs'} border-slate-200`}>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-600" />
        </CardContent>
      </Card>
    );
  }
  
  if (error) {
    return (
      <Card className="w-full max-w-xs border-red-200 bg-red-50">
        <CardContent className="flex items-center justify-center py-8 text-red-600">
          <AlertCircle className="w-5 h-5 mr-2" />
          <span className="text-sm">Clock unavailable</span>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <TooltipProvider>
      <Card className={`
        ${compact ? 'w-[220px]' : 'w-full max-w-xs'}
        border-slate-200 bg-white shadow-sm
        transition-all duration-300
      `}>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-medium text-slate-700 flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-600" />
            Transplant Clock
          </CardTitle>
          <p className="text-xs text-slate-500">System Activity Rhythm</p>
        </CardHeader>
        
        <CardContent className="px-4 pb-4">
          {/* Clock Face */}
          <div className="relative flex items-center justify-center my-4">
            {/* Outer Pulse Ring */}
            <motion.div
              className={`absolute rounded-full ${statusColors.ring}`}
              style={{
                width: compact ? 160 : 180,
                height: compact ? 160 : 180,
                boxShadow: `0 0 30px ${statusColors.glow}40, 0 0 60px ${statusColors.glow}20`,
              }}
              animate={{
                scale: [1, 1.03, 1],
                opacity: [0.5, 1, 0.5],
              }}
              transition={{
                duration: pulseDuration,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
            
            {/* Clock Border Ring */}
            <div 
              className={`
                relative rounded-full border-4 ${statusColors.border}
                flex items-center justify-center
                transition-colors duration-500
              `}
              style={{
                width: compact ? 150 : 170,
                height: compact ? 150 : 170,
                background: `linear-gradient(135deg, ${COLORS.panelBg} 0%, ${COLORS.surface} 100%)`,
              }}
            >
              {/* Inner glow based on status */}
              <div 
                className="absolute inset-2 rounded-full"
                style={{
                  background: `radial-gradient(circle, ${statusColors.glow}10 0%, transparent 70%)`,
                }}
              />
              
              {/* Clock Hand */}
              <motion.div
                className="absolute"
                style={{
                  width: 2,
                  height: compact ? 50 : 60,
                  backgroundColor: COLORS.clockHand,
                  transformOrigin: 'bottom center',
                  borderRadius: 1,
                  bottom: '50%',
                }}
                animate={{ rotate: clockHandRotation }}
                transition={{ duration: 1, ease: 'easeOut' }}
              />
              
              {/* Center dot */}
              <div 
                className="absolute w-3 h-3 rounded-full bg-slate-800"
                style={{ boxShadow: `0 0 4px ${statusColors.glow}` }}
              />
              
              {/* Clock Face Content */}
              <div className="relative z-10 text-center">
                <Tooltip>
                  <TooltipTrigger>
                    <div className={`text-2xl font-bold ${statusColors.text}`}>
                      {formatHours(clockData?.timeSinceLastUpdate?.hours)}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Time since last system update</p>
                  </TooltipContent>
                </Tooltip>
                <div className="text-xs text-slate-500">since update</div>
              </div>
            </div>
          </div>
          
          {/* Metrics Grid */}
          <div className="grid grid-cols-2 gap-2 mt-4">
            {/* Average Resolution */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">
                    <TrendingUp className="w-3 h-3" />
                    <span>Avg Resolution</span>
                  </div>
                  <div className="font-semibold text-slate-800">
                    {formatHours(clockData?.averageResolutionTime?.hours)}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Average task resolution time</p>
                <p className="text-xs text-slate-400">
                  Based on {clockData?.averageResolutionTime?.sampleSize || 0} resolved tasks
                </p>
              </TooltipContent>
            </Tooltip>
            
            {/* Next Expiration */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">
                    <Calendar className="w-3 h-3" />
                    <span>Next Expiry</span>
                  </div>
                  <div className="font-semibold text-slate-800">
                    {clockData?.nextExpiration?.days !== null 
                      ? `${clockData.nextExpiration.days}d` 
                      : '—'}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {clockData?.nextExpiration?.days !== null ? (
                  <>
                    <p>Next expiration: {clockData.nextExpiration.type}</p>
                    <p className="text-xs text-slate-400">
                      {new Date(clockData.nextExpiration.date).toLocaleDateString()}
                    </p>
                  </>
                ) : (
                  <p>No upcoming expirations</p>
                )}
              </TooltipContent>
            </Tooltip>
          </div>
          
          {/* Task Summary */}
          <div className="mt-3 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-500">Tasks:</span>
              <Badge variant="secondary" className="text-xs px-1.5 py-0">
                {clockData?.tasks?.open || 0} open
              </Badge>
              {(clockData?.tasks?.overdue || 0) > 0 && (
                <Badge variant="destructive" className="text-xs px-1.5 py-0">
                  {clockData.tasks.overdue} overdue
                </Badge>
              )}
            </div>
          </div>
          
          {/* Coordinator Load */}
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <Users className="w-3 h-3" />
              <span>Team Load:</span>
            </div>
            <Badge className={`${loadColors.bg} ${loadColors.text} text-xs border-0`}>
              {clockData?.coordinatorLoad?.label || 'Unknown'}
            </Badge>
          </div>
          
          {/* Pulse indicator */}
          <div className="mt-3 flex items-center justify-center gap-2">
            <motion.div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: statusColors.glow }}
              animate={{
                scale: [1, 1.5, 1],
                opacity: [1, 0.5, 1],
              }}
              transition={{
                duration: pulseDuration,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
            <span className="text-xs text-slate-400">
              {clockData?.pulseRate?.toFixed(1) || '0.5'} Hz
            </span>
          </div>
          
          {/* Non-clinical disclaimer */}
          <div className="mt-3 text-center">
            <span className="text-[10px] text-slate-400">
              Operational metrics • Non-clinical
            </span>
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
