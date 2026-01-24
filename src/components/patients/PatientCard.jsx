import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { User, Phone, Mail, Calendar, Heart, Droplet, Clock, ExternalLink } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import PriorityBadge from '../waitlist/PriorityBadge';
import { createPageUrl } from '@/utils';
import { Link } from 'react-router-dom';

export default function PatientCard({ patient }) {
  const organLabels = {
    kidney: 'Kidney',
    liver: 'Liver',
    heart: 'Heart',
    lung: 'Lung',
    pancreas: 'Pancreas',
    kidney_pancreas: 'Kidney-Pancreas',
    intestine: 'Intestine',
  };

  const statusColors = {
    active: 'bg-green-100 text-green-700 border-green-200',
    temporarily_inactive: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    transplanted: 'bg-blue-100 text-blue-700 border-blue-200',
    removed: 'bg-slate-100 text-slate-700 border-slate-200',
    deceased: 'bg-slate-200 text-slate-800 border-slate-300',
  };

  const daysOnWaitlist = patient.date_added_to_waitlist
    ? Math.floor((new Date() - new Date(patient.date_added_to_waitlist)) / (1000 * 60 * 60 * 24))
    : 0;

  return (
    <Card className="hover:shadow-lg transition-shadow duration-300 border-slate-200">
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start space-x-3">
            <div className="bg-gradient-to-br from-cyan-500 to-teal-600 p-3 rounded-xl">
              <User className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                {patient.first_name} {patient.last_name}
              </h3>
              <p className="text-sm text-slate-500">ID: {patient.patient_id}</p>
            </div>
          </div>
          
          <PriorityBadge score={patient.priority_score || 0} size="sm" />
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center space-x-2 text-sm">
              <Heart className="w-4 h-4 text-cyan-600" />
              <span className="text-slate-600">Organ:</span>
              <span className="font-medium text-slate-900">{organLabels[patient.organ_needed]}</span>
            </div>

            <div className="flex items-center space-x-2 text-sm">
              <Droplet className="w-4 h-4 text-red-600" />
              <span className="text-slate-600">Blood:</span>
              <span className="font-medium text-slate-900">{patient.blood_type}</span>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-sm">
            <Clock className="w-4 h-4 text-slate-500" />
            <span className="text-slate-600">On waitlist:</span>
            <span className="font-medium text-slate-900">{daysOnWaitlist} days</span>
          </div>

          {patient.last_evaluation_date && (
            <div className="flex items-center space-x-2 text-sm">
              <Calendar className="w-4 h-4 text-slate-500" />
              <span className="text-slate-600">Last eval:</span>
              <span className="font-medium text-slate-900">
                {format(new Date(patient.last_evaluation_date), 'MMM d, yyyy')}
              </span>
            </div>
          )}

          <div className="pt-2 border-t border-slate-100">
            <Badge variant="secondary" className={`${statusColors[patient.waitlist_status]} border`}>
              {patient.waitlist_status.replace(/_/g, ' ').toUpperCase()}
            </Badge>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-100">
          <Link to={createPageUrl('PatientDetails') + `?id=${patient.id}`}>
            <Button variant="outline" className="w-full" size="sm">
              <ExternalLink className="w-4 h-4 mr-2" />
              View Details
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}