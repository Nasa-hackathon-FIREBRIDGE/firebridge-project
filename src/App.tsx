import { lazy, Suspense } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { queryClient } from './lib/queryClient'
import { AppStateProvider } from './state'
import { ApplicationShell } from './components/ApplicationShell'
import { SystemStatus } from './components/SystemStatus'

const HomePage = lazy(() => import('./pages/HomePage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const CatalogPage = lazy(() => import('./pages/CatalogPage'))
const ApiAnalysisPage = lazy(() => import('./pages/ApiAnalysisPage'))
const IngestionPage = lazy(() => import('./pages/IngestionPage'))
const EvidencePage = lazy(() => import('./pages/EvidencePage'))
const AnalysisWorkspace = lazy(() => import('./features/analyses/AnalysisWorkspace'))
const DemoWorkspace = lazy(() => import('./features/demo/DemoWorkspace'))
const DemoControls = lazy(() => import('./features/demo/DemoControls'))

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppStateProvider>
        <BrowserRouter>
          <AppLayout />
        </BrowserRouter>
      </AppStateProvider>
    </QueryClientProvider>
  )
}

function AppLayout() {
  return <ApplicationShell demoControls={<Suspense fallback={null}><DemoControls /></Suspense>} sidebarFooter={<SystemStatus />}><AppPages /></ApplicationShell>
}

function AppPages() {
  return (
    <Routes>
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/catalog" element={<CatalogPage />} />
      <Route path="/analyses" element={<AnalysisWorkspace />} />
      <Route path="/api-analysis" element={<Suspense fallback={<p role="status">Chargement…</p>}><ApiAnalysisPage /></Suspense>} />
      <Route path="/ingestion" element={<Suspense fallback={<p role="status">Chargement…</p>}><IngestionPage /></Suspense>} />
      <Route path="/" element={<HomePage />} />
      <Route path="/demo" element={<DemoWorkspace page="overview" />} />
      <Route path="/explore" element={<DemoWorkspace page="explore" />} />
      <Route path="/compare" element={<DemoWorkspace page="compare" />} />
      <Route path="/calendar" element={<DemoWorkspace page="calendar" />} />
      <Route path="/weather" element={<DemoWorkspace page="weather" />} />
      <Route path="/reports" element={<DemoWorkspace page="reports" />} />
      <Route path="/explain" element={<DemoWorkspace page="explain" />} />
      <Route path="/alerts" element={<DemoWorkspace page="alerts" />} />
      <Route path="/evidence" element={<EvidencePage />} />
      <Route path="/settings" element={<DemoWorkspace page="settings" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}


export default App
