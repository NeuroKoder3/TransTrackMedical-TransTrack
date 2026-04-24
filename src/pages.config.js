import Dashboard from './pages/Dashboard';
import DonorMatching from './pages/DonorMatching';
import Notifications from './pages/Notifications';
import PatientDetails from './pages/PatientDetails';
import Patients from './pages/Patients';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import PrioritySettings from './pages/PrioritySettings';
import EHRIntegration from './pages/EHRIntegration';
import RiskDashboard from './pages/RiskDashboard';
import ComplianceCenter from './pages/ComplianceCenter';
import DisasterRecovery from './pages/DisasterRecovery';
import OutcomesDashboard from './pages/OutcomesDashboard';
import PredictiveRisk from './pages/PredictiveRisk';
import TaskCenter from './pages/TaskCenter';
import CMSReadiness from './pages/CMSReadiness';
import AccountSecurity from './pages/AccountSecurity';
import OrganOffers from './pages/OrganOffers';
import PostTransplant from './pages/PostTransplant';
import LivingDonors from './pages/LivingDonors';
import Hl7Inbox from './pages/Hl7Inbox';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Dashboard": Dashboard,
    "DonorMatching": DonorMatching,
    "Notifications": Notifications,
    "PatientDetails": PatientDetails,
    "Patients": Patients,
    "Reports": Reports,
    "Settings": Settings,
    "PrioritySettings": PrioritySettings,
    "EHRIntegration": EHRIntegration,
    "RiskDashboard": RiskDashboard,
    "ComplianceCenter": ComplianceCenter,
    "DisasterRecovery": DisasterRecovery,
    "OutcomesDashboard": OutcomesDashboard,
    "PredictiveRisk": PredictiveRisk,
    "TaskCenter": TaskCenter,
    "CMSReadiness": CMSReadiness,
    "AccountSecurity": AccountSecurity,
    "OrganOffers": OrganOffers,
    "PostTransplant": PostTransplant,
    "LivingDonors": LivingDonors,
    "Hl7Inbox": Hl7Inbox,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};
