/**
 * UpgradePrompt Component
 * 
 * Modal/dialog for prompting users to upgrade their license
 * when hitting limits or attempting restricted features.
 */

import React from 'react';
import { 
  CreditCard, 
  Mail, 
  ExternalLink, 
  Shield, 
  Star, 
  Crown,
  Check,
  ArrowRight
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const TIER_INFO = {
  starter: {
    name: 'Starter',
    price: '$2,499',
    icon: Shield,
    color: 'border-blue-200 bg-blue-50',
    features: [
      'Single workstation',
      'Up to 500 patients',
      'Email support (48hr)',
      '1 year updates',
      'Basic audit reporting',
    ],
  },
  professional: {
    name: 'Professional',
    price: '$7,499',
    icon: Star,
    color: 'border-purple-200 bg-purple-50',
    popular: true,
    features: [
      'Up to 5 workstations',
      'Unlimited patients',
      'Priority support (24hr)',
      '2 years updates',
      'Advanced audit reporting',
      'FHIR R4 import/export',
      'Custom priority config',
    ],
  },
  enterprise: {
    name: 'Enterprise',
    price: '$24,999',
    icon: Crown,
    color: 'border-emerald-200 bg-emerald-50',
    features: [
      'Unlimited workstations',
      'Unlimited patients',
      '24/7 phone & email support',
      'Lifetime updates',
      'Full compliance reporting',
      'Custom integrations',
      'On-site training',
      'Source code escrow',
    ],
  },
};

export default function UpgradePrompt({ 
  open, 
  onClose, 
  reason = 'feature',
  blockedFeature = null,
  currentLimit = null,
}) {
  const handleContactSales = () => {
    window.open('mailto:Trans_Track@outlook.com?subject=TransTrack%20License%20Inquiry', '_blank');
  };

  const handlePayPal = (tier) => {
    const amounts = {
      starter: '2499',
      professional: '7499',
      enterprise: '24999',
    };
    // Open PayPal payment
    window.open(`https://www.paypal.me/lilnicole0383/${amounts[tier]}USD`, '_blank');
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-cyan-600" />
            Upgrade Your License
          </DialogTitle>
          <DialogDescription>
            {reason === 'limit' && currentLimit && (
              <span className="text-red-600">
                You've reached your {currentLimit} limit. Upgrade to continue.
              </span>
            )}
            {reason === 'feature' && blockedFeature && (
              <span className="text-amber-600">
                This feature requires a higher license tier.
              </span>
            )}
            {reason === 'expired' && (
              <span className="text-red-600">
                Your evaluation period has expired. Please purchase a license.
              </span>
            )}
            {!reason && 'Unlock more features and higher limits with a paid license.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          {Object.entries(TIER_INFO).map(([tier, info]) => {
            const Icon = info.icon;
            return (
              <Card 
                key={tier} 
                className={`relative ${info.color} ${info.popular ? 'ring-2 ring-purple-400' : ''}`}
              >
                {info.popular && (
                  <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 bg-purple-600">
                    Most Popular
                  </Badge>
                )}
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2">
                    <Icon className="w-5 h-5" />
                    {info.name}
                  </CardTitle>
                  <CardDescription>
                    <span className="text-2xl font-bold text-slate-900">{info.price}</span>
                    <span className="text-sm text-slate-500"> one-time</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-2 text-sm">
                    {info.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Button 
                    className="w-full"
                    variant={info.popular ? 'default' : 'outline'}
                    onClick={() => handlePayPal(tier)}
                  >
                    Purchase
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-6 p-4 bg-slate-50 rounded-lg">
          <h4 className="font-medium mb-2">How to Purchase</h4>
          <ol className="text-sm text-slate-600 space-y-2">
            <li className="flex items-start gap-2">
              <span className="font-bold text-cyan-600">1.</span>
              Click "Purchase" on your chosen tier to pay via PayPal
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-cyan-600">2.</span>
              Include your Organization ID in the payment note
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-cyan-600">3.</span>
              Email Trans_Track@outlook.com with payment confirmation
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-cyan-600">4.</span>
              Receive your license key within 24-48 hours
            </li>
          </ol>
        </div>

        <div className="flex justify-between items-center mt-4 pt-4 border-t">
          <Button variant="outline" onClick={handleContactSales}>
            <Mail className="w-4 h-4 mr-2" />
            Contact Sales
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Maybe Later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
