import { useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { Shield } from 'lucide-react';

export default function JustificationDialog({ open, onConfirm, onCancel, entityType, action }) {
  const [justification, setJustification] = useState('');

  const predefinedReasons = [
    'Direct patient care',
    'Care coordination',
    'Clinical review',
    'Quality assurance audit',
    'Regulatory compliance review',
    'Emergency access',
  ];

  const handleSubmit = () => {
    if (!justification.trim()) return;
    onConfirm(justification.trim());
    setJustification('');
  };

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel(); }}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-amber-600" />
            Access Justification Required
          </AlertDialogTitle>
          <AlertDialogDescription>
            Accessing {entityType || 'patient'} records requires a documented reason per HIPAA policy. 
            This will be recorded in the audit log.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 py-2">
          <Label htmlFor="justification-reason">Select or describe your reason</Label>
          <div className="flex flex-wrap gap-2">
            {predefinedReasons.map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => setJustification(reason)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  justification === reason
                    ? 'bg-cyan-50 border-cyan-300 text-cyan-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                {reason}
              </button>
            ))}
          </div>
          <textarea
            id="justification-reason"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Or type a custom justification..."
            className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm resize-none h-20 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleSubmit} disabled={!justification.trim()}>
            Confirm Access
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
