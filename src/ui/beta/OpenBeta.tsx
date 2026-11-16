import { useEffect, useState } from 'react';
import '../styles/beta.css';

/**
 * Private open beta (built with `npm run open-beta`): a corner pill with the build stamp and a
 * notebook for things to fix or improve. Notes stay in this browser and can be copied or saved as
 * a text file to hand over. Only the open beta build loads this file.
 */
interface Note { id: number; at: number; where: string; text: string; done?: boolean }

const KEY = 'clutch-manager.openbeta.notes';
const VERSION = import.meta.env.VITE_OPEN_BETA_VERSION ?? '';
const BUILT = import.meta.env.VITE_OPEN_BETA_BUILT ?? '';

const load = (): Note[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Note[]; } catch { return []; } };
const save = (n: Note[]) => { try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* storage full or blocked */ } };

/** The screen the player is on: the open tab's label, or the open dialog's title. */
function whereNow(): string {
  const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].map((d) => d.getAttribute('aria-label')).filter((l) => l && l !== 'Open beta notes').pop();
  const tab = document.querySelector<HTMLElement>('nav [aria-current="page"]')?.textContent?.trim();
  return dialog || tab || 'Home';
}

const stamp = (t: number) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function asText(notes: Note[]): string {
  const head = `Clutch Manager open beta ${VERSION} (built ${BUILT}), ${notes.length} note${notes.length === 1 ? '' : 's'}`;
  return [head, '', ...notes.map((n, i) => `${i + 1}. [${n.done ? 'done' : 'open'}] ${n.where}, ${stamp(n.at)}\n   ${n.text.replace(/\n/g, '\n   ')}`)].join('\n');
}

export default function OpenBetaBar() {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>(load);
  const [text, setText] = useState('');
  const [where, setWhere] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => save(notes), [notes]);
  const openCount = notes.filter((n) => !n.done).length;

  const show = () => { setWhere(whereNow()); setOpen(true); };
  const add = () => {
    const t = text.trim();
    if (!t) return;
    setNotes((n) => [{ id: Date.now(), at: Date.now(), where: where || 'Home', text: t }, ...n]);
    setText('');
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(asText(notes)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { download(); }
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([asText(notes)], { type: 'text/plain' }));
    a.download = `clutch-open-beta-notes-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <>
      <button className="beta-pill open-beta" onClick={show} aria-label="Open beta notes">
        <span className="beta-badge">Open beta</span>
        {VERSION && <span className="num">v{VERSION}</span>}
        <span>Notes{openCount > 0 && <> · <span className="num">{openCount}</span></>}</span>
      </button>
      {open && (
        <div className="overlay" onClick={() => setOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Open beta notes" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head"><h2>Open beta notes</h2><button className="btn small ghost" onClick={() => setOpen(false)}>Close</button></div>
            <p className="small muted">Your private build, v{VERSION}, built {BUILT}. Write down anything to fix or make better; notes stay on this device. Copy them and paste them to Claude to work through.</p>
            <label className="ob-field">
              <span className="small muted">On: <b>{where || 'Home'}</b></span>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="What felt wrong, broken or could be better?"
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add(); }} />
            </label>
            <div className="ob-row">
              <button className="btn primary" onClick={add} disabled={!text.trim()}>Add note</button>
              <span className="ob-spacer" />
              <button className="btn small" onClick={copy} disabled={!notes.length}>{copied ? 'Copied' : 'Copy all'}</button>
              <button className="btn small" onClick={download} disabled={!notes.length}>Save .txt</button>
            </div>
            {notes.length === 0 ? <p className="small faint">No notes yet.</p> : (
              <ul className="ob-notes">
                {notes.map((n) => (
                  <li key={n.id} className={n.done ? 'done' : undefined}>
                    <div className="small muted">{n.where} · {stamp(n.at)}</div>
                    <div className="ob-text">{n.text}</div>
                    <div className="ob-row">
                      <button className="btn small ghost" onClick={() => setNotes((all) => all.map((x) => (x.id === n.id ? { ...x, done: !x.done } : x)))}>{n.done ? 'Reopen' : 'Mark done'}</button>
                      <button className="btn small ghost" onClick={() => setNotes((all) => all.filter((x) => x.id !== n.id))}>Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
