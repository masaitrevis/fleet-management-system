import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Layout from '@/components/Layout';
import DriverShell from '@/components/DriverShell';
import { ToastStack } from '@/components/shared';
import Dashboard from '@/pages/Dashboard';
import Login from '@/pages/Login';
import NotFound from '@/pages/NotFound';
import { stub } from '@/pages/stubs';
import Alerts from '@/pages/admin/Alerts';
import Reports from '@/pages/admin/Reports';
import Analytics from '@/pages/admin/Analytics';
import AdminUsers from '@/pages/admin/AdminUsers';
import AdminAudit from '@/pages/admin/AdminAudit';
import BulkUpload from '@/pages/admin/BulkUpload';
import Settings from '@/pages/admin/Settings';
import { startSim } from '@/lib/sim';

// Route stubs — replaced by page agents (design.md §11).
const Tracking = stub('Live Tracking & Route Replay');
const Geofences = stub('Geofences');
const Drivers = stub('Drivers');
const DriverDetail = stub('Driver 360°');
const Safety = stub('Safety Events & Coaching');
const Rewards = stub('Driver Rewards');
const Dvir = stub('Vehicle Inspection (DVIR)', 'Mobile-first pre/post-trip checklist — page agent implements per dvir.md.');
const Shifts = stub('Shifts & Driving Hours');
const Documents = stub('Document Vault');
const Maintenance = stub('Work Orders');
const MaintSchedules = stub('Preventive Schedules');
const MaintParts = stub('Parts & Vendors');
const Vehicles = stub('Vehicles');
const VehicleDetail = stub('Vehicle 360°');
const Fuel = stub('Fuel Management');
const FuelAnalytics = stub('Fuel Analytics');
const Trips = stub('Trips');
const Dispatch = stub('Dispatch Board');
const DispatchDetail = stub('Job Detail');
const DispatchRun = stub('Job Run & POD', 'Driver mobile run view with proof of delivery — page agent implements per dispatch.md.');
const Assets = stub('Assets & Equipment');
const DriverHome = stub('Driver Home', 'Mobile driver home — today’s jobs, DVIR prompt, shift status.');

export default function App() {
  useEffect(() => {
    startSim();
    return () => { /* keep sim running across route changes */ };
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* authenticated ops shell (nested routes — Layout renders <Outlet/>) */}
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="tracking" element={<Tracking />} />
          <Route path="geofences" element={<Geofences />} />
          <Route path="drivers" element={<Drivers />} />
          <Route path="drivers/:id" element={<DriverDetail />} />
          <Route path="safety" element={<Safety />} />
          <Route path="rewards" element={<Rewards />} />
          <Route path="documents" element={<Documents />} />
          <Route path="maintenance" element={<Maintenance />} />
          <Route path="maintenance/schedules" element={<MaintSchedules />} />
          <Route path="maintenance/parts" element={<MaintParts />} />
          <Route path="vehicles" element={<Vehicles />} />
          <Route path="vehicles/:id" element={<VehicleDetail />} />
          <Route path="fuel" element={<Fuel />} />
          <Route path="fuel/analytics" element={<FuelAnalytics />} />
          <Route path="trips" element={<Trips />} />
          <Route path="dispatch" element={<Dispatch />} />
          <Route path="dispatch/:id" element={<DispatchDetail />} />
          <Route path="assets" element={<Assets />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="reports" element={<Reports />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="admin/users" element={<AdminUsers />} />
          <Route path="admin/audit" element={<AdminAudit />} />
          <Route path="admin/bulk-upload" element={<BulkUpload />} />
          <Route path="settings" element={<Settings />} />
        </Route>

        {/* mobile driver shell (nested — DriverShell renders <Outlet/>) */}
        <Route element={<DriverShell />}>
          <Route path="driver" element={<DriverHome />} />
          <Route path="dvir" element={<Dvir />} />
          <Route path="shifts" element={<Shifts />} />
          <Route path="dispatch/:id/run" element={<DispatchRun />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
      <ToastStack />
    </BrowserRouter>
  );
}
