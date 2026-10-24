import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { currentUser, onAuth, signIn, signOut, signUp } from '../../online/supa';
import { betaAccess, betaDay, betaDays, betaPing, dueSurvey, markSurvey, redeemInvite, rememberInvite, sendSurvey } from '../../online/beta';
import type { BetaAccess, BetaStatus, SurveyId } from '../../online/beta';
import { ContactForm } from '../ContactForm';
import '../styles/beta.css';

const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long' });

/** Closed beta door: invite code, sign in, the beta window. Renders the game only for beta players (or when there is no beta). */
export function BetaGate({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<BetaAccess | null>(null);
  const pinged = useRef(false);
  const check = useCallback(async () => {
    let me = null;
    try { me = await currentUser(); } catch { /* no online build */ }
    setAccess(await betaAccess(!!me));
  }, []);

  useEffect(() => {
    void check();
    let off: (() => void) | undefined;
    onAuth(() => { void check(); }).then((f) => { off = f; }).catch(() => {});
    return () => off?.();
  }, [check]);

  useEffect(() => {
    if (access?.kind === 'in' && !pinged.current) { pinged.current = true; void betaPing(); }
  }, [access]);

  if (!access) return <Door><p className="muted">Checking your beta place…</p></Door>;
  if (access.kind === 'open') return <>{children}</>;
  if (access.kind === 'in') return <><BetaBar s={access.s} />{children}</>;
  if (access.kind === 'offline') {
    return <Door><h1>Can’t reach the game server</h1><p className="muted">The closed beta checks your invite online. Check your connection and try again.</p>
      <button className="btn primary" onClick={() => { setAccess(null); void check(); }}>Try again</button></Door>;
  }
  if (access.kind === 'signed-out') return <Door s={access.s}><Join onDone={check} /></Door>;
  if (access.kind === 'need-code') return <Door s={access.s}><CodeOnly onDone={check} first={access.reason} /></Door>;
  if (access.kind === 'not-started') {
    return <Door s={access.s}><h1>You’re in!</h1>
      <p>Your place in the closed beta is saved. The game opens on <b>{fmtDate(access.s.startsAt)}</b>, {untilText(access.s)}.</p>
      <p className="small muted">Come back then and sign in with the same email.</p>
      <SignOutLink /></Door>;
  }
  return <Door s={access.s}><Ended s={access.s} /></Door>;
}

function untilText(s: BetaStatus): string {
  const h = Math.max(0, Math.round((s.startsAt - s.now) / 3_600_000));
  return h >= 48 ? `in ${Math.round(h / 24)} days` : h >= 1 ? `in ${h} hours` : 'in a few minutes';
}

function Door({ s, children }: { s?: BetaStatus; children: ReactNode }) {
  return (
    <main className="beta-door">
      <section className="panel beta-card">
        <div className="beta-brand"><span className="wordmark">Clutch Manager</span><span className="beta-badge">Closed beta</span></div>
        {s && <p className="small muted beta-meta">{fmtDate(s.startsAt)} – {fmtDate(s.endsAt - 1)} · {s.players} of {s.maxPlayers} places taken</p>}
        {children}
      </section>
    </main>
  );
}

function SignOutLink() {
  return <button className="btn small ghost" onClick={() => { void signOut(); }}>Sign out</button>;
}

function Join({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'up' | 'in'>('up');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      if (mode === 'in') {
        const r = await signIn(email, password);
        if (!r.ok) setMsg({ bad: true, text: r.reason });
        return;
      }
      if (code.replace(/[^A-Za-z0-9]/g, '').length !== 10) { setMsg({ bad: true, text: 'Invite codes look like CM-7KQ2-XP9D.' }); return; }
      rememberInvite(code);
      const r = await signUp(email, password);
      if (!r.ok) { setMsg({ bad: true, text: r.reason }); return; }
      if (r.needsConfirm) { setMsg({ bad: false, text: 'Account created. Open the confirmation link in your inbox, then sign in here. Your code is saved on this device.' }); setMode('in'); return; }
      onDone(); // redeems the remembered code with the new session
    } finally { setBusy(false); }
  };
  return (
    <>
      <div className="seg" role="group" aria-label="Account">
        <button type="button" aria-pressed={mode === 'up'} onClick={() => setMode('up')}>I have an invite</button>
        <button type="button" aria-pressed={mode === 'in'} onClick={() => setMode('in')}>Sign in</button>
      </div>
      <h1>{mode === 'up' ? 'Join the closed beta' : 'Welcome back'}</h1>
      {mode === 'up' && <p className="small muted">The beta is invite only. Each code works once and makes your account a beta player.</p>}
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {mode === 'up' && <label className="field"><span className="label">Invite code</span>
          <input value={code} required autoComplete="off" spellCheck={false} placeholder="CM-7KQ2-XP9D" className="beta-code" onChange={(e) => setCode(e.target.value.toUpperCase())} /></label>}
        <label className="field"><span className="label">Email</span><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field"><span className="label">Password</span><input type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button type="submit" className={`btn primary${busy ? ' loading' : ''}`} disabled={busy}>{mode === 'up' ? 'Create account and join' : 'Sign in'}</button>
      </form>
      {msg && <p className={`small ${msg.bad ? 'bad' : 'good'}`} role="alert">{msg.text}</p>}
      <p className="small faint">Your email is only used to sign in. Other managers never see it.</p>
    </>
  );
}

function CodeOnly({ onDone, first }: { onDone: () => void; first?: string }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(first ?? null);
  useEffect(() => { if (first) setMsg(first); }, [first]);
  const submit = async () => {
    setBusy(true); setMsg(null);
    const r = await redeemInvite(code);
    setBusy(false);
    if (r.ok) onDone(); else setMsg(r.reason);
  };
  return (
    <>
      <h1>Enter your invite code</h1>
      <p className="small muted">This account isn’t in the closed beta yet. Enter the code from your invite to join.</p>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="field"><span className="label">Invite code</span>
          <input value={code} required autoComplete="off" spellCheck={false} placeholder="CM-7KQ2-XP9D" className="beta-code" onChange={(e) => setCode(e.target.value.toUpperCase())} /></label>
        <button type="submit" className={`btn primary${busy ? ' loading' : ''}`} disabled={busy}>Join the beta</button>
      </form>
      {msg && <p className="small bad" role="alert">{msg}</p>}
      <SignOutLink />
    </>
  );
}

function Ended({ s }: { s: BetaStatus }) {
  const [survey, setSurvey] = useState<SurveyId | null>(() => (s.invited ? dueSurvey(s, s.endsAt - 1) : null));
  return (
    <>
      <h1>The closed beta has ended</h1>
      <p>Thank you for playing. Your career is saved on this device and will be there when the game opens again.</p>
      {survey && <Survey id={survey} onClose={() => setSurvey(null)} />}
      <SignOutLink />
    </>
  );
}

// ------------------------------------------------------------------ in-game strip

function BetaBar({ s }: { s: BetaStatus }) {
  const [open, setOpen] = useState<null | 'feedback' | SurveyId>(null);
  const [due, setDue] = useState<SurveyId | null>(() => dueSurvey(s));
  const day = Math.min(betaDay(s), betaDays(s));
  return (
    <>
      <button className={`beta-pill${due ? ' due' : ''}`} onClick={() => setOpen(due ?? 'feedback')} aria-label="Closed beta: feedback and survey">
        <span className="beta-badge">Beta</span>
        {s.startsAt > 0 && <span className="num">Day {day}/{betaDays(s)}</span>}
        <span>{due ? 'Survey' : 'Feedback'}</span>
      </button>
      {open && (
        <div className="overlay" onClick={() => setOpen(null)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Closed beta" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head"><h2>Closed beta</h2><button className="btn small ghost" onClick={() => setOpen(null)}>Close</button></div>
            {due && (
              <div className="seg" role="group" aria-label="Section">
                <button type="button" aria-pressed={open !== 'feedback'} onClick={() => setOpen(due)}>Survey</button>
                <button type="button" aria-pressed={open === 'feedback'} onClick={() => setOpen('feedback')}>Feedback or bug</button>
              </div>
            )}
            {open === 'feedback'
              ? <><p className="small muted">Bugs, ideas, anything. For a bug, say what you did just before it happened, and on which device.</p><ContactForm initialTopic="bug" /></>
              : <Survey id={open} onClose={() => { setDue(null); setOpen(null); }} />}
          </div>
        </div>
      )}
    </>
  );
}

const PLAY = ['Less than 1 hour', '1 to 3 hours', '3 to 6 hours', 'More than 6 hours'];

function Survey({ id, onClose }: { id: SurveyId; onClose: () => void }) {
  const [score, setScore] = useState<number | null>(null);
  const [hours, setHours] = useState('');
  const [best, setBest] = useState('');
  const [worst, setWorst] = useState('');
  const [more, setMore] = useState('');
  const [keep, setKeep] = useState('');
  const [state, setState] = useState<{ kind: 'idle' | 'sending' | 'sent' | 'error'; msg?: string }>({ kind: 'idle' });
  const submit = async () => {
    setState({ kind: 'sending' });
    const r = await sendSurvey(id, { score: score ?? -1, hours, best: best.slice(0, 1000), worst: worst.slice(0, 1000), more: more.slice(0, 1000), ...(id === 'final' ? { keep } : {}) });
    setState(r.ok ? { kind: 'sent' } : { kind: 'error', msg: r.reason });
  };
  if (state.kind === 'sent') {
    return <div className="st-report ok"><strong className="good">Thanks, that really helps.</strong><button className="btn small ghost" onClick={onClose}>Back to the game</button></div>;
  }
  return (
    <form className="stack beta-survey" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p className="small muted">{id === 'week2' ? 'Two weeks in. Five quick questions.' : 'The beta is nearly over. Six quick questions.'}</p>
      <fieldset><legend className="label">How likely are you to recommend Clutch Manager to a friend? (0 to 10)</legend>
        <div className="beta-scale">{Array.from({ length: 11 }, (_, i) => (
          <button type="button" key={i} aria-pressed={score === i} onClick={() => setScore(i)}>{i}</button>))}</div>
      </fieldset>
      <label className="field"><span className="label">How much did you play last week?</span>
        <select value={hours} onChange={(e) => setHours(e.target.value)}><option value="">Choose…</option>{PLAY.map((p) => <option key={p}>{p}</option>)}</select></label>
      <label className="field"><span className="label">What do you enjoy most?</span><textarea value={best} maxLength={1000} onChange={(e) => setBest(e.target.value)} /></label>
      <label className="field"><span className="label">What frustrates you or feels broken?</span><textarea value={worst} maxLength={1000} onChange={(e) => setWorst(e.target.value)} /></label>
      <label className="field"><span className="label">What would make you play more?</span><textarea value={more} maxLength={1000} onChange={(e) => setMore(e.target.value)} /></label>
      {id === 'final' && <label className="field"><span className="label">Will you keep playing when the game opens to everyone?</span>
        <select value={keep} onChange={(e) => setKeep(e.target.value)}><option value="">Choose…</option><option>Yes</option><option>Maybe</option><option>No</option></select></label>}
      {state.kind === 'error' && <span className="bad small">{state.msg}</span>}
      <div className="st-actions">
        <button type="button" className="btn small ghost" onClick={() => { markSurvey(id); onClose(); }}>Skip</button>
        <button type="submit" className="btn small primary" disabled={state.kind === 'sending' || score === null}>{state.kind === 'sending' ? 'Sending…' : 'Send answers'}</button>
      </div>
    </form>
  );
}
