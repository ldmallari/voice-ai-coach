import { isSupabaseConfigured, serverClient } from './supabase';

/**
 * Coaching session persistence.
 *
 * Behind an interface so the chat path can be tested without a database, and so
 * a missing Supabase configuration degrades to in-memory rather than failing the
 * conversation. Sessions are the record of what was advised and when, which is
 * what makes an end-of-session summary possible.
 */

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
  sources: string[];
}

export interface ActionItem {
  action: string;
  why: string;
  priority: 'high' | 'medium' | 'low';
}

export interface SessionStore {
  create(): Promise<string>;
  append(sessionId: string, turn: Turn): Promise<void>;
  transcript(sessionId: string): Promise<Turn[]>;
  finish(sessionId: string, summary: string, actions: ActionItem[]): Promise<void>;
}

/** Used in tests, and as a fallback when Supabase isn't configured. */
export function inMemoryStore(): SessionStore {
  const sessions = new Map<string, Turn[]>();
  let counter = 0;

  return {
    async create() {
      counter += 1;
      const id = `session_${counter}`;
      sessions.set(id, []);
      return id;
    },
    async append(sessionId, turn) {
      const existing = sessions.get(sessionId);
      if (!existing) throw new Error(`Unknown session: ${sessionId}`);
      existing.push(turn);
    },
    async transcript(sessionId) {
      return sessions.get(sessionId) ?? [];
    },
    async finish() {
      // Nothing to persist in memory; the summary is returned to the caller.
    },
  };
}

function supabaseStore(): SessionStore {
  return {
    async create() {
      const { data, error } = await serverClient()
        .from('coaching_sessions')
        .insert({})
        .select('id')
        .single();

      if (error) throw new Error(`Could not start session: ${error.message}`);
      return data.id as string;
    },

    async append(sessionId, turn) {
      const { error } = await serverClient().from('coaching_messages').insert({
        session_id: sessionId,
        role: turn.role,
        content: turn.content,
        sources: turn.sources,
      });

      if (error) throw new Error(`Could not save message: ${error.message}`);
    },

    async transcript(sessionId) {
      const { data, error } = await serverClient()
        .from('coaching_messages')
        .select('role, content, sources')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

      if (error) throw new Error(`Could not read session: ${error.message}`);

      return (data ?? []).map((row) => ({
        role: row.role as Turn['role'],
        content: row.content as string,
        sources: (row.sources as string[]) ?? [],
      }));
    },

    async finish(sessionId, summary, actions) {
      const { error } = await serverClient()
        .from('coaching_sessions')
        .update({
          ended_at: new Date().toISOString(),
          summary,
          action_plan: actions,
        })
        .eq('id', sessionId);

      if (error) throw new Error(`Could not close session: ${error.message}`);
    },
  };
}

/** Chooses persistence based on configuration, loudly rather than silently. */
export function sessionStore(): SessionStore {
  if (isSupabaseConfigured()) return supabaseStore();
  console.warn('[sessions] Supabase not configured; sessions are in-memory only.');
  return inMemoryStore();
}
