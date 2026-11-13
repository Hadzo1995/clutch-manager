import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { TournamentApp } from './ui/tournament/TournamentApp';
import './ui/fonts';
import { LeagueApp } from './ui/league/LeagueApp';
import { BetaGate } from './ui/beta/BetaGate';
import './ui/styles.css';
import './ui/styles/premium.css';
import { applyMotion } from './ui/motion';
import { registerOffline, restoreFromNative, setupNative } from './platform';

applyMotion();
registerOffline();

/** The career game, the beta tournament (#tournament) or the Clutch League (#league). */
function Root() {
  const where = () => (location.hash.startsWith('#tournament') ? 'tournament' : location.hash.startsWith('#league') ? 'league' : 'career');
  const [mode, setMode] = useState(where);
  useEffect(() => {
    const on = () => { setMode(where()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const exit = () => { location.hash = ''; };
  return mode === 'tournament' ? <TournamentApp onExit={exit} /> : mode === 'league' ? <LeagueApp onExit={exit} /> : <App />;
}

// The native app first copies its saves back from native storage (see platform.ts), then hides the splash.
void restoreFromNative().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BetaGate><Root /></BetaGate>
    </StrictMode>,
  );
  void setupNative();
});
