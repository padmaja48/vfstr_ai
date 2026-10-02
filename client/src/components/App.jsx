import React, { useEffect, useRef, useState, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Login } from './Login';
import { Register } from './Register';
import { Dashboard } from './Dashboard';
import Profile from './Profile';
import { Interview } from './Interview';
import { Results } from './Results';
import Sidebar from './Sidebar';
import { AccountSetupModal } from './AccountSetupModal';
import api from '../services/api';
import '../styles/App.css';

export const App = () => {
  const { authenticated, user, initializing, logout } = useContext(AuthContext);
  const toast = useToast();
  const lastHealthToastRef = useRef('');
  const [currentView, setCurrentView] = useState(() => {
    const saved = localStorage.getItem('currentView') || 'dashboard';
    if (saved === 'practice' || saved === 'tests') return 'dashboard';
    return saved;
  });
  const [showLogin, setShowLogin] = useState(true);
  const [healthWarning, setHealthWarning] = useState('');

  useEffect(() => {
    document.documentElement.dataset.theme = 'light';
  }, []);

  useEffect(() => {
    let cancelled = false;
    const checkHealth = async () => {
      try {
        const res = await api.get('/health');
        if (cancelled) return;
        const warnings = Array.isArray(res.data?.warnings) ? res.data.warnings : [];
        const critical = warnings.filter((w) => !/TTS key/i.test(String(w)));
        if (res.data?.status === 'degraded' || res.data?.mongodb !== 'connected' || !res.data?.capabilities?.llm) {
          setHealthWarning(critical[0] || warnings[0] || 'Interview service is degraded. Some features may fail.');
        } else {
          setHealthWarning('');
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err?.response?.data?.message || err?.response?.data?.error;
        if (err?.response?.status === 503) {
          setHealthWarning(msg || 'Database unavailable. Interviews cannot be saved until MongoDB is back.');
        } else if (!err?.response) {
          setHealthWarning('Cannot reach the interview API. Check that the server is running.');
        } else {
          setHealthWarning(msg || 'Interview service health check failed.');
        }
      }
    };
    checkHealth();
    const id = setInterval(checkHealth, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!healthWarning) {
      lastHealthToastRef.current = '';
      return;
    }
    if (lastHealthToastRef.current === healthWarning) return;
    lastHealthToastRef.current = healthWarning;
    toast.warning(healthWarning, { duration: 6500 });
  }, [healthWarning, toast]);

  const handleSetView = (view) => {
    setCurrentView(view);
    localStorage.setItem('currentView', view);
  };

  const handleLogout = () => {
    logout();
    localStorage.removeItem('currentView');
    setCurrentView('dashboard');
    setShowLogin(true);
  };

  const needsAccountSetup = Boolean(user?.requiresAccountSetup);

  if (initializing) {
    return <div className="loading">Loading...</div>;
  }

  if (!authenticated && !initializing) {
    return showLogin ? (
      <Login />
    ) : (
      <Register onSwitchToLogin={() => setShowLogin(true)} />
    );
  }

  return (
    <div className="app-container app-container--topnav">
      <AccountSetupModal open={needsAccountSetup} />
      {!needsAccountSetup ? (
        <>
          <Sidebar
            currentView={currentView}
            onViewChange={handleSetView}
            onLogout={handleLogout}
            user={user}
          />
          <div className="main-content">
            {healthWarning ? (
              <div className="app-health-banner" role="alert">
                {healthWarning}
              </div>
            ) : null}
            <div className="content-area" data-view={currentView}>
              {currentView === 'dashboard' && <Dashboard setCurrentView={handleSetView} />}
              {currentView === 'profile' && <Profile />}
              {currentView === 'interview' && <Interview setCurrentView={handleSetView} />}
              {currentView === 'results' && <Results setCurrentView={handleSetView} />}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};

export default App;
