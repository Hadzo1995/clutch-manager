import { onlineAvailable, supa } from '../online/supa';

/**
 * Contact form. On the self-hosted game it writes to the contact_messages
 * table (supabase/schema.sql), which nobody can read from the game.
 * On the claude.ai page it uses the page's shared database. Each viewer writes only
 * their own messages (contact/<their id>/msgs/<id>); only the page owner can
 * read them (db rules declared at publish). The owner's address never appears
 * in the page: a scheduled job forwards new messages to the owner's inbox.
 */
interface Snap { id: string; exists: boolean; data(): Record<string, unknown> | undefined }
interface DocRef { set(d: Record<string, unknown>): Promise<void> }
interface Query { orderBy(f: string, dir?: 'asc' | 'desc'): Query; limit(n: number): Query; get(): Promise<{ docs: Snap[] }> }
interface DB { doc(p: string): DocRef; collectionGroup?(id: string): Query }
interface UserCap { me(): Promise<{ id: string | null; name: string }> }
type ClaudeWin = { claude?: { use(name: string): Promise<unknown> } };

export interface ContactMessage { topic: 'removal' | 'feedback' | 'bug' | 'other'; text: string; reply?: string }

export const CONTACT_TOPICS: { id: ContactMessage['topic']; label: string }[] = [
  { id: 'removal', label: 'Remove my name from the game' },
  { id: 'bug', label: 'Report a bug' },
  { id: 'feedback', label: 'Feedback or idea' },
  { id: 'other', label: 'Something else' },
];

export const CONTACT_MAX = 2000;

export async function sendContact(m: ContactMessage): Promise<{ ok: true } | { ok: false; reason: string }> {
  const text = m.text.trim();
  if (text.length < 5) return { ok: false, reason: 'Please write a few more words.' };
  if (text.length > CONTACT_MAX) return { ok: false, reason: `Please keep it under ${CONTACT_MAX} characters.` };
  if (onlineAvailable()) {
    try {
      const sb = await supa();
      const r = await sb.from('contact_messages').insert({ topic: m.topic, body: text, reply_to: (m.reply ?? '').trim().slice(0, 200) || null });
      if (!r.error) return { ok: true };
      return { ok: false, reason: /too many/i.test(r.error.message) ? r.error.message : 'Sending failed. Check your connection and try again.' };
    } catch {
      return { ok: false, reason: 'Sending failed. Check your connection and try again.' };
    }
  }
  const c = (window as unknown as ClaudeWin).claude;
  if (!c?.use) return { ok: false, reason: 'The contact form only works on the hosted game page.' };
  try {
    const [db, user] = await Promise.all([c.use('db'), c.use('user')]) as [DB | null, UserCap | null];
    if (!db || !user) return { ok: false, reason: 'Sign in to claude.ai to send a message.' };
    const me = await user.me();
    if (!me.id) return { ok: false, reason: 'Sign in to claude.ai to send a message.' };
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await db.doc(`contact/${me.id}/msgs/${id}`).set({
      topic: m.topic, text, reply: (m.reply ?? '').trim().slice(0, 200), from: me.name || '', at: Date.now(), forwarded: false,
    });
    return { ok: true };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    return { ok: false, reason: code === 'invalid_argument' || code === 'permission_denied' ? 'You need Contributor access to this page to send a message.' : 'Sending failed. Check your connection and try again.' };
  }
}
