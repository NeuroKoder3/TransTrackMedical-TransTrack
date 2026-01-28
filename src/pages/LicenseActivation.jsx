/**
 * LicenseActivation Page
 * 
 * Comprehensive license management page including:
 * - License status display
 * - License activation
 * - Tier selection and purchase
 * - PayPal payment integration
 * - Organization management
 */

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { 
  Loader2, Key, Shield, ExternalLink, Mail, Clock, CheckCircle, 
  CreditCard, Building, Star, Crown, AlertTriangle, Copy, RefreshCw,
  ArrowRight, Check, Info
} from 'lucide-react';

const TIER_CONFIG = {
  starter: {
    name: 'Starter',
    price: 2499,
    icon: Shield,
    color: 'border-blue-200 bg-blue-50',
    badge: 'bg-blue-100 text-blue-800',
    features: [
      'Single workstation',
      'Up to 500 patients',
      'Email support (48hr)',
      '1 year updates',
      'Basic audit reporting',
    ],
    maintenance: 499,
  },
  professional: {
    name: 'Professional',
    price: 7499,
    icon: Star,
    color: 'border-purple-200 bg-purple-50',
    badge: 'bg-purple-100 text-purple-800',
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
    maintenance: 1499,
  },
  enterprise: {
    name: 'Enterprise',
    price: 24999,
    icon: Crown,
    color: 'border-emerald-200 bg-emerald-50',
    badge: 'bg-emerald-100 text-emerald-800',
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
    maintenance: 4999,
  },
};

export default function LicenseActivation({ onActivated }) {
  const queryClient = useQueryClient();
  const [licenseKey, setLicenseKey] = useState('');
  const [customerInfo, setCustomerInfo] = useState({
    name: '',
    email: '',
    organization: '',
  });
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('status');
  const [copied, setCopied] = useState(false);

  // Fetch license info
  const { data: licenseInfo, isLoading: loadingInfo, refetch } = useQuery({
    queryKey: ['licenseInfo'],
    queryFn: async () => {
      if (window.electronAPI?.license) {
        return await window.electronAPI.license.getInfo();
      }
      return null;
    },
  });

  // Fetch organization info
  const { data: orgInfo } = useQuery({
    queryKey: ['organizationInfo'],
    queryFn: async () => {
      if (window.electronAPI?.license) {
        return await window.electronAPI.license.getOrganization();
      }
      return null;
    },
  });

  // Activation mutation
  const activateMutation = useMutation({
    mutationFn: async ({ key, info }) => {
      if (!window.electronAPI?.license) throw new Error('License API not available');
      return await window.electronAPI.license.activate(key, info);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['licenseInfo']);
      queryClient.invalidateQueries(['organizationInfo']);
      setError('');
      if (onActivated) onActivated();
    },
    onError: (err) => {
      setError(err.message || 'Failed to activate license');
    },
  });

  // Set customer info from org info
  useEffect(() => {
    if (orgInfo) {
      setCustomerInfo(prev => ({
        ...prev,
        organization: orgInfo.name || prev.organization,
      }));
    }
  }, [orgInfo]);

  const formatLicenseKey = (value) => {
    const cleaned = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const parts = [];
    for (let i = 0; i < cleaned.length && i < 25; i += 5) {
      parts.push(cleaned.substring(i, i + 5));
    }
    return parts.join('-');
  };

  const handleKeyChange = (e) => {
    setLicenseKey(formatLicenseKey(e.target.value));
  };

  const handleActivate = async (e) => {
    e.preventDefault();
    setError('');
    activateMutation.mutate({ key: licenseKey, info: customerInfo });
  };

  const handleContinueEvaluation = () => {
    if (onActivated) onActivated();
  };

  const handlePayPal = (tier) => {
    const amount = TIER_CONFIG[tier].price;
    window.open(`https://www.paypal.me/lilnicole0383/${amount}USD`, '_blank');
  };

  const handleContactSales = () => {
    window.open('mailto:Trans_Track@outlook.com?subject=TransTrack%20License%20Inquiry', '_blank');
  };

  const copyOrgId = () => {
    if (orgInfo?.id) {
      navigator.clipboard.writeText(orgInfo.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isEvaluationBuild = licenseInfo?.buildVersion === 'evaluation';
  const isEvaluationExpired = licenseInfo?.evaluationExpired;
  const daysRemaining = licenseInfo?.evaluationDaysRemaining || 0;
  const canActivate = licenseInfo?.canActivate !== false;

  if (loadingInfo) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-cyan-50 via-slate-50 to-cyan-100 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-cyan-50 via-slate-50 to-cyan-100 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-cyan-600 rounded-2xl mb-4 shadow-lg">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900">TransTrack</h1>
          <p className="text-slate-600 mt-2">License Management</p>
        </div>

        {/* Evaluation Build Warning */}
        {isEvaluationBuild && (
          <Alert className="mb-6 bg-amber-50 border-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-700">
              <strong>Evaluation Build:</strong> This is the evaluation version of TransTrack. 
              To activate a license, please download the Enterprise version.
            </AlertDescription>
          </Alert>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="status">License Status</TabsTrigger>
            <TabsTrigger value="activate" disabled={!canActivate}>Activate License</TabsTrigger>
            <TabsTrigger value="purchase">Purchase</TabsTrigger>
          </TabsList>

          {/* Status Tab */}
          <TabsContent value="status">
            <div className="grid gap-6 md:grid-cols-2">
              {/* Current License */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-cyan-600" />
                    Current License
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {licenseInfo?.isLicensed ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">Status</span>
                        <Badge className="bg-green-100 text-green-700">Active</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">Tier</span>
                        <Badge className={TIER_CONFIG[licenseInfo.tier]?.badge || 'bg-slate-100'}>
                          {licenseInfo.tierName}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">License Key</span>
                        <span className="font-mono text-xs">{licenseInfo.licenseKey}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">Activated</span>
                        <span className="text-sm">
                          {licenseInfo.activatedAt ? new Date(licenseInfo.activatedAt).toLocaleDateString() : '—'}
                        </span>
                      </div>
                      {licenseInfo.maintenance && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-slate-600">Maintenance</span>
                          <Badge className={licenseInfo.maintenance.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>
                            {licenseInfo.maintenance.active ? 'Active' : 'Expired'}
                          </Badge>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className={`p-4 rounded-lg ${isEvaluationExpired ? 'bg-red-50' : 'bg-amber-50'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className={`w-4 h-4 ${isEvaluationExpired ? 'text-red-600' : 'text-amber-600'}`} />
                        <span className={`font-medium ${isEvaluationExpired ? 'text-red-700' : 'text-amber-700'}`}>
                          {isEvaluationExpired ? 'Evaluation Expired' : 'Evaluation Mode'}
                        </span>
                      </div>
                      <p className={`text-sm ${isEvaluationExpired ? 'text-red-600' : 'text-amber-600'}`}>
                        {isEvaluationExpired 
                          ? 'Your 14-day evaluation has expired.'
                          : `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining.`
                        }
                      </p>
                    </div>
                  )}

                  {!isEvaluationExpired && !licenseInfo?.isLicensed && (
                    <Button variant="outline" className="w-full" onClick={handleContinueEvaluation}>
                      Continue Evaluation
                    </Button>
                  )}
                </CardContent>
              </Card>

              {/* Organization */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Building className="w-5 h-5 text-cyan-600" />
                    Organization
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Organization ID</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs bg-slate-100 px-2 py-1 rounded">
                        {orgInfo?.id || '—'}
                      </span>
                      <Button variant="ghost" size="sm" onClick={copyOrgId}>
                        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Name</span>
                    <span className="text-sm">{orgInfo?.name || licenseInfo?.orgName || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Created</span>
                    <span className="text-sm">
                      {orgInfo?.createdAt ? new Date(orgInfo.createdAt).toLocaleDateString() : '—'}
                    </span>
                  </div>

                  <Alert className="bg-blue-50 border-blue-200">
                    <Info className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-blue-700 text-xs">
                      Include your Organization ID when making a purchase for faster license delivery.
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Activate Tab */}
          <TabsContent value="activate">
            <Card className="max-w-lg mx-auto">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="w-5 h-5 text-cyan-600" />
                  Activate License
                </CardTitle>
                <CardDescription>
                  Enter your license key to activate TransTrack
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!canActivate && (
                  <Alert className="mb-4 bg-amber-50 border-amber-200">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-amber-700">
                      License activation is not available on this build. 
                      Please download the Enterprise version.
                    </AlertDescription>
                  </Alert>
                )}

                <form onSubmit={handleActivate} className="space-y-4">
                  {error && (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="organization">Organization Name</Label>
                    <Input
                      id="organization"
                      placeholder="Your Hospital or Clinic"
                      value={customerInfo.organization}
                      onChange={(e) => setCustomerInfo({ ...customerInfo, organization: e.target.value })}
                      required
                      disabled={activateMutation.isPending || !canActivate}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Contact Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="admin@organization.com"
                      value={customerInfo.email}
                      onChange={(e) => setCustomerInfo({ ...customerInfo, email: e.target.value })}
                      disabled={activateMutation.isPending || !canActivate}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="licenseKey">License Key</Label>
                    <Input
                      id="licenseKey"
                      placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
                      value={licenseKey}
                      onChange={handleKeyChange}
                      required
                      disabled={activateMutation.isPending || !canActivate}
                      className="font-mono tracking-wider"
                      maxLength={29}
                    />
                    <p className="text-xs text-slate-500">
                      Format: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX
                    </p>
                  </div>

                  <Button
                    type="submit"
                    className="w-full bg-cyan-600 hover:bg-cyan-700"
                    disabled={activateMutation.isPending || licenseKey.length < 29 || !canActivate}
                  >
                    {activateMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Activating...
                      </>
                    ) : (
                      <>
                        <Key className="w-4 h-4 mr-2" />
                        Activate License
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Purchase Tab */}
          <TabsContent value="purchase">
            <div className="space-y-6">
              {/* Pricing Cards */}
              <div className="grid gap-4 md:grid-cols-3">
                {Object.entries(TIER_CONFIG).map(([tier, config]) => {
                  const Icon = config.icon;
                  return (
                    <Card 
                      key={tier} 
                      className={`relative ${config.color} ${config.popular ? 'ring-2 ring-purple-400' : ''}`}
                    >
                      {config.popular && (
                        <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 bg-purple-600 text-white">
                          Most Popular
                        </Badge>
                      )}
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2">
                          <Icon className="w-5 h-5" />
                          {config.name}
                        </CardTitle>
                        <CardDescription>
                          <span className="text-2xl font-bold text-slate-900">
                            ${config.price.toLocaleString()}
                          </span>
                          <span className="text-sm text-slate-500"> one-time</span>
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <ul className="space-y-2 text-sm">
                          {config.features.map((feature, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <Check className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                              <span>{feature}</span>
                            </li>
                          ))}
                        </ul>
                        <Separator />
                        <p className="text-xs text-slate-500">
                          Annual maintenance: ${config.maintenance}/year (after initial period)
                        </p>
                        <Button 
                          className="w-full"
                          variant={config.popular ? 'default' : 'outline'}
                          onClick={() => handlePayPal(tier)}
                        >
                          <CreditCard className="w-4 h-4 mr-2" />
                          Pay with PayPal
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Purchase Instructions */}
              <Card>
                <CardHeader>
                  <CardTitle>How to Purchase</CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-3 text-sm">
                    <li className="flex items-start gap-3">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-100 text-cyan-700 font-bold text-xs shrink-0">1</span>
                      <div>
                        <p className="font-medium">Click "Pay with PayPal" on your chosen tier</p>
                        <p className="text-slate-500">You'll be redirected to PayPal to complete payment</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-100 text-cyan-700 font-bold text-xs shrink-0">2</span>
                      <div>
                        <p className="font-medium">Include your Organization ID in the payment note</p>
                        <p className="text-slate-500">
                          Your Organization ID: <code className="bg-slate-100 px-1 rounded">{orgInfo?.id || 'Loading...'}</code>
                        </p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-100 text-cyan-700 font-bold text-xs shrink-0">3</span>
                      <div>
                        <p className="font-medium">Email us with payment confirmation</p>
                        <p className="text-slate-500">Send to: Trans_Track@outlook.com</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-100 text-cyan-700 font-bold text-xs shrink-0">4</span>
                      <div>
                        <p className="font-medium">Receive your license key within 24-48 hours</p>
                        <p className="text-slate-500">Activate in the "Activate License" tab</p>
                      </div>
                    </li>
                  </ol>

                  <Separator className="my-6" />

                  <div className="flex gap-4">
                    <Button variant="outline" onClick={handleContactSales}>
                      <Mail className="w-4 h-4 mr-2" />
                      Contact Sales
                    </Button>
                    <Button variant="outline" onClick={() => window.open('mailto:Trans_Track@outlook.com?subject=TransTrack%20Demo%20Request', '_blank')}>
                      Request Demo
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Discounts */}
              <Card className="bg-slate-50">
                <CardHeader>
                  <CardTitle className="text-lg">Discounts Available</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-3 text-sm">
                    <div>
                      <p className="font-medium">Nonprofit Organizations</p>
                      <p className="text-slate-500">25% discount</p>
                    </div>
                    <div>
                      <p className="font-medium">Academic Institutions</p>
                      <p className="text-slate-500">40% discount</p>
                    </div>
                    <div>
                      <p className="font-medium">Multi-Year Commitments</p>
                      <p className="text-slate-500">Volume pricing available</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mt-4">
                    Contact sales@transtrack.com to inquire about discount eligibility.
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* Compliance Footer */}
        <div className="mt-8 text-center">
          <div className="flex items-center justify-center gap-3 text-xs text-slate-500">
            <span className="px-2 py-1 bg-white rounded border border-slate-200">HIPAA Compliant</span>
            <span className="px-2 py-1 bg-white rounded border border-slate-200">FDA 21 CFR Part 11</span>
            <span className="px-2 py-1 bg-white rounded border border-slate-200">AATB Standards</span>
          </div>
        </div>
      </div>
    </div>
  );
}
