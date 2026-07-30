import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Layout from '@/components/Layout';
import DriverShell from '@/components/DriverShell';
import { ToastStack } from '@/components/shared';
import Dashboard from '@/pages/Dashboard';
import Login from '@/pages/Login';
import NotFound from '@/pages/NotFound';
import DriverHome from '@/pages/driver/DriverHome';
import TrackingPage from '@/pages/tracking/TrackingPage';
import GeofencesPage from '@/pages/tracking/GeofencesPage';
import TripsPage from '@/pages/tracking/TripsPage';
import Drivers from '@/pages/drivers/Drivers';
import DriverDetail from '@/pages/drivers/DriverDetail';
import Safety from '@/pages/drivers/Safety';
import Rewards from '@/pages/drivers/Rewards';
import Dvir from '@/pages/drivers/Dvir';
import Shifts from '@/pages/drivers/Shifts';
import Documents from '@/pages/fleet/Documents';
import Maintenance from '@/pages/fleet/Maintenance';
import MaintSchedules from '@/pages/fleet/Schedules';
import MaintParts from '@/pages/fleet/Parts';
import Vehicles from '@/pages/fleet/Vehicles';
import VehicleDetail from '@/pages/fleet/VehicleDetail';
import Alerts from '@/pages/admin/Alerts';
import Reports from '@/pages/admin/Reports';
import Analytics from '@/pages/admin/Analytics';
import AdminUsers from '@/pages/admin/AdminUsers';
import AdminAudit from '@/pages/admin/AdminAudit';
import BulkUpload from '@/pages/admin/BulkUpload';
import Settings from '@/pages/admin/Settings';
import { startSim } from '@/lib/sim';
import FuelLogPage from '@/pages/ops/FuelLogPage';
import FuelAnalyticsPage from '@/pages/ops/FuelAnalyticsPage';
import DispatchBoardPage from '@/pages/ops/DispatchBoardPage';
import JobDetailPage from '@/pages/ops/JobDetailPage';
import JobRunPage from '@/pages/ops/JobRunPage';
import AssetsPage from '@/pages/ops/AssetsPage';

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
          <Route path="tracking" element={<TrackingPage />} />
          <Route path="geofences" element={<GeofencesPage />} />
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
          <Route path="fuel" element={<FuelLogPage />} />
          <Route path="fuel/analytics" element={<FuelAnalyticsPage />} />
          <Route path="trips" element={<TripsPage />} />
          <Route path="dispatch" element={<DispatchBoardPage />} />
          <Route path="dispatch/:id" element={<JobDetailPage />} />
          <Route path="assets" element={<AssetsPage />} />
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
          <Route path="dispatch/:id/run" element={<JobRunPage />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
      <ToastStack />
    </BrowserRouter>
  );
}
