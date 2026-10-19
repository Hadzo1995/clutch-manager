import { useState } from 'react';
import { CONTACT_MAX, CONTACT_TOPICS, sendContact } from './contact';
import type { ContactMessage } from './contact';

/** Message to the developer without showing any address in the page. */
export function ContactForm({ initialTopic = 'feedback' }: { initialTopic?: ContactMessage['topic'] }) {
  const [topic, setTopic] = useState<ContactMessage['topic']>(initialTopic);
  const [text, setText] = useState('');
  const [reply, setReply] = useState('');
  const [state, setState] = useState<{ kind: 'idle' | 'sending' | 'sent' | 'error'; msg?: string }>({ kind: 'idle' });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ kind: 'sending' });
    const r = await sendContact({ topic, text, reply });
    if (r.ok) { setState({ kind: 'sent' }); setText(''); } else setState({ kind: 'error', msg: r.reason });
  };

  if (state.kind === 'sent') {
    return (
      <div className="st-report ok">
        <strong className="good">Message sent.</strong>
        <span className="muted">The developer will read it. Removal requests are handled in the next update.</span>
        <button className="btn small ghost" onClick={() => setState({ kind: 'idle' })}>Write another</button>
      </div>
    );
  }
  return (
    <form className="stack" style={{ gap: 10 }} onSubmit={submit}>
      <div className="field"><label className="label" htmlFor="ct-topic">About</label>
        <select id="ct-topic" value={topic} onChange={(e) => setTopic(e.target.value as ContactMessage['topic'])}>
          {CONTACT_TOPICS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>
      <div className="field"><label className="label" htmlFor="ct-text">Message</label>
        <textarea id="ct-text" value={text} maxLength={CONTACT_MAX} onChange={(e) => setText(e.target.value)}
          placeholder={topic === 'removal' ? 'Your player name and team, and how we can confirm it is you.' : 'What happened, or what you would like to see.'} />
      </div>
      <div className="field"><label className="label" htmlFor="ct-reply">How to reach you (optional)</label>
        <input id="ct-reply" value={reply} maxLength={200} onChange={(e) => setReply(e.target.value)} placeholder="Email, Discord or similar, if you want an answer" />
      </div>
      {state.kind === 'error' && <span className="bad small">{state.msg}</span>}
      <div className="st-actions"><button className="btn small primary" type="submit" disabled={state.kind === 'sending' || text.trim().length < 5}>{state.kind === 'sending' ? 'Sending…' : 'Send message'}</button></div>
    </form>
  );
}
