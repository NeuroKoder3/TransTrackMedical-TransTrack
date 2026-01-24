import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, X } from 'lucide-react';

export default function FilterBar({ filters, setFilters, onReset }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search patients..."
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            className="pl-10"
          />
        </div>

        <Select
          value={filters.organ}
          onValueChange={(value) => setFilters({ ...filters, organ: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="All Organs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Organs</SelectItem>
            <SelectItem value="kidney">Kidney</SelectItem>
            <SelectItem value="liver">Liver</SelectItem>
            <SelectItem value="heart">Heart</SelectItem>
            <SelectItem value="lung">Lung</SelectItem>
            <SelectItem value="pancreas">Pancreas</SelectItem>
            <SelectItem value="kidney_pancreas">Kidney-Pancreas</SelectItem>
            <SelectItem value="intestine">Intestine</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.bloodType}
          onValueChange={(value) => setFilters({ ...filters, bloodType: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="All Blood Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Blood Types</SelectItem>
            <SelectItem value="A+">A+</SelectItem>
            <SelectItem value="A-">A-</SelectItem>
            <SelectItem value="B+">B+</SelectItem>
            <SelectItem value="B-">B-</SelectItem>
            <SelectItem value="AB+">AB+</SelectItem>
            <SelectItem value="AB-">AB-</SelectItem>
            <SelectItem value="O+">O+</SelectItem>
            <SelectItem value="O-">O-</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.status}
          onValueChange={(value) => setFilters({ ...filters, status: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="temporarily_inactive">Temporarily Inactive</SelectItem>
            <SelectItem value="transplanted">Transplanted</SelectItem>
            <SelectItem value="removed">Removed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-sm text-slate-600">Priority:</span>
          <Select
            value={filters.priority}
            onValueChange={(value) => setFilters({ ...filters, priority: value })}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button variant="ghost" size="sm" onClick={onReset} className="text-slate-600">
          <X className="w-4 h-4 mr-1" />
          Clear Filters
        </Button>
      </div>
    </div>
  );
}