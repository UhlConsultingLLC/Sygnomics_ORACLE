import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from './components/Layout';
import Welcome from './pages/Welcome';
import Dashboard from './pages/Dashboard';
import TrialExplorer from './pages/TrialExplorer';
import TrialDetail from './pages/TrialDetail';
import Conditions from './pages/Conditions';
import MOAOverview from './pages/MOAOverview';
import Filtering from './pages/Filtering';
import Simulation from './pages/Simulation';
import TrialEligibilityComparison from './pages/TrialEligibilityComparison';
import NovelTherapySimulation from './pages/NovelTherapySimulation';
import MOACorrelation from './pages/MOACorrelation';
import ThresholdValidation from './pages/ThresholdValidation';
import ScreeningImpact from './pages/ScreeningImpact';
import TAMEstimator from './pages/TAMEstimator';
import Export from './pages/Export';
import TCGACohort from './pages/TCGACohort';
import CTISImport from './pages/CTISImport';
import WHOClassification from './pages/WHOClassification';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Welcome />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/trials" element={<TrialExplorer />} />
            <Route path="/trials/:nctId" element={<TrialDetail />} />
            <Route path="/conditions" element={<Conditions />} />
            <Route path="/moa" element={<MOAOverview />} />
            <Route path="/filtering" element={<Filtering />} />
            <Route path="/simulation" element={<Simulation />} />
            <Route path="/trial-comparison" element={<TrialEligibilityComparison />} />
            <Route path="/novel-therapy" element={<NovelTherapySimulation />} />
            <Route path="/moa-correlation" element={<MOACorrelation />} />
            <Route path="/threshold-validation" element={<ThresholdValidation />} />
            <Route path="/screening-impact" element={<ScreeningImpact />} />
            <Route path="/tam-estimator" element={<TAMEstimator />} />
            <Route path="/tcga" element={<TCGACohort />} />
            <Route path="/ctis" element={<CTISImport />} />
            <Route path="/who" element={<WHOClassification />} />
            <Route path="/export" element={<Export />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
