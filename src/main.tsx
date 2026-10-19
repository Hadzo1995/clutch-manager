import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { TournamentApp } from './ui/tournament/TournamentApp';
import './ui/styles.css';
import './ui/styles/premium.css';

/** The career game, or the beta tournament when the address ends in #tournament. */
function Root() {
  const isTournament = () => location.hash.startsWith('#tournament');
  const [tournament, setTournament] = useState(isTournament);
  useEffect(() => {
    const on = () => { setTournament(isTournament()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return tournament ? <TournamentApp onExit={() => { location.hash = ''; }} /> : <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
