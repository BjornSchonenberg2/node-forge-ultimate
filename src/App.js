import { useState } from 'react';
import './App.css';
import NodeForge from './Interactive3DNodeShowcase';
import LandingPage from './ui/LandingPage';

export default function App() {
  const [session, setSession] = useState(null);

  if (!session) {
    return <LandingPage onEnter={setSession} />;
  }

  return <NodeForge activeProject={session} onRequestReturnToLander={() => setSession(null)} />;
}
