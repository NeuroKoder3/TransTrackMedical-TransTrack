/**
 * EvaluationWatermark Component
 * 
 * Displays a persistent watermark for evaluation builds.
 * Shows "EVALUATION VERSION - NOT FOR CLINICAL USE"
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';

export default function EvaluationWatermark() {
  const { data: licenseInfo } = useQuery({
    queryKey: ['licenseInfo'],
    queryFn: async () => {
      if (window.electronAPI?.license) {
        return await window.electronAPI.license.getInfo();
      }
      return null;
    },
    staleTime: 60000,
  });

  // Only show watermark for evaluation
  if (!licenseInfo?.isEvaluation) {
    return null;
  }

  const isExpired = licenseInfo.evaluationExpired;
  const daysRemaining = licenseInfo.evaluationDaysRemaining;

  return (
    <>
      {/* Top banner */}
      <div 
        className={`fixed top-0 left-0 right-0 z-50 py-1 px-4 text-center text-xs font-medium ${
          isExpired 
            ? 'bg-red-600 text-white' 
            : 'bg-amber-500 text-amber-950'
        }`}
      >
        <div className="flex items-center justify-center gap-2">
          <AlertTriangle className="w-3 h-3" />
          <span>
            {isExpired 
              ? 'EVALUATION EXPIRED - Please purchase a license to continue'
              : `EVALUATION VERSION - NOT FOR CLINICAL USE - ${daysRemaining} day(s) remaining`
            }
          </span>
          <AlertTriangle className="w-3 h-3" />
        </div>
      </div>

      {/* Diagonal watermark overlay */}
      <div 
        className="fixed inset-0 pointer-events-none z-40 overflow-hidden"
        aria-hidden="true"
      >
        <div 
          className="absolute inset-0 flex items-center justify-center"
          style={{
            transform: 'rotate(-45deg)',
          }}
        >
          <div 
            className="text-slate-200/20 font-bold whitespace-nowrap"
            style={{
              fontSize: '120px',
              letterSpacing: '0.2em',
            }}
          >
            EVALUATION
          </div>
        </div>
      </div>

      {/* Bottom corner badge */}
      <div 
        className={`fixed bottom-4 right-4 z-50 px-3 py-2 rounded-lg shadow-lg text-xs font-medium ${
          isExpired 
            ? 'bg-red-600 text-white' 
            : 'bg-amber-100 text-amber-800 border border-amber-300'
        }`}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          <div>
            <div className="font-bold">
              {isExpired ? 'Evaluation Expired' : 'Evaluation Version'}
            </div>
            <div className="text-[10px] opacity-80">
              {isExpired 
                ? 'Contact sales@transtrack.com'
                : `${daysRemaining} day(s) remaining`
              }
            </div>
          </div>
        </div>
      </div>

      {/* Add top padding to account for banner */}
      <style>{`
        body {
          padding-top: 28px;
        }
      `}</style>
    </>
  );
}
