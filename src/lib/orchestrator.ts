import type { CoachAnswer } from './agent';

/**
 * Client for the n8n main-orchestration workflow.
 *
 * The challenge requires n8n to be the main orchestration layer, so when it is
 * configured the coaching turn is run by the n8n AI Agent (which owns tool
 * selection, the vector store and session memory) rather than the in-process
 * loop. The in-process agent stays as a fallback so a slow or unreachable n8n
 * never takes the whole app down.
 */

export function isN8nCoachConfigured(): boolean {
  return Boolean(process.env.N8N_COACH_URL);
}

/**
 * Asks the n8n coach workflow to answer a question.
 * Throws on any failure so the caller can fall back to the in-process agent.
 */
export async function askN8nCoach(
  question: string,
  sessionId?: string,
): Promise<CoachAnswer> {
  const url = process.env.N8N_COACH_URL;
  if (!url) throw new Error('N8N_COACH_URL is not configured.');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.N8N_WEBHOOK_SECRET
        ? { 'X-Coach-Secret': process.env.N8N_WEBHOOK_SECRET }
        : {}),
    },
    body: JSON.stringify({ question, sessionId }),
    // Bound the wait so a stuck workflow triggers the fallback instead of hanging.
    signal: AbortSignal.timeout(45000),
  });

  if (!response.ok) {
    throw new Error(`n8n coach responded ${response.status}.`);
  }

  const data = (await response.json()) as { answer?: string; output?: string };
  const answer = (data.answer ?? data.output ?? '').trim();
  if (!answer) throw new Error('n8n coach returned an empty answer.');

  return { answer, sources: [], path: 'both', toolCalls: [] };
}
