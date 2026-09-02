import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { summariseSession } from '@/lib/summary';
import type { Turn } from '@/lib/sessions';

/** The LLM is mocked; what matters is parsing, validation and the fallback. */
function fakeClient(content: string): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({ choices: [{ message: { content } }] }),
      },
    },
  } as unknown as OpenAI;
}

const transcript: Turn[] = [
  { role: 'user', content: 'Why are consultations not converting?', sources: [] },
  {
    role: 'assistant',
    content: 'CoolSculpting converts at 7% against a 52% clinic average.',
    sources: ['clinic customer data'],
  },
];

describe('summariseSession', () => {
  it('returns a structured plan from valid JSON', async () => {
    const client = fakeClient(
      JSON.stringify({
        summary: 'CoolSculpting is underperforming badly.',
        actions: [
          {
            action: 'Sit in on three CoolSculpting consultations',
            why: 'Conversion is 7% against a 52% average',
            priority: 'high',
          },
        ],
      }),
    );

    const result = await summariseSession(transcript, client);

    expect(result.summary).toContain('CoolSculpting');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].priority).toBe('high');
  });

  it('does not call the model for an empty session', async () => {
    const client = fakeClient('{}');
    const result = await summariseSession([], client);

    expect(result.actions).toEqual([]);
    expect(result.summary).toMatch(/No conversation/i);
    expect(client.chat.completions.create).not.toHaveBeenCalled();
  });

  it('falls back to the raw text when the JSON is malformed', async () => {
    // Failure case: the model ignores the format instruction.
    const client = fakeClient('Conversion is down on CoolSculpting, look at it.');
    const result = await summariseSession(transcript, client);

    expect(result.summary).toContain('CoolSculpting');
    expect(result.actions).toEqual([]);
  });

  it('falls back when the JSON parses but fails validation', async () => {
    // Valid JSON, invalid priority: must not reach the UI as-is.
    const client = fakeClient(
      JSON.stringify({ summary: 'ok', actions: [{ action: 'x', why: 'y', priority: 'urgent' }] }),
    );

    const result = await summariseSession(transcript, client);
    expect(result.actions).toEqual([]);
  });

  it('gives a readable message when the model returns nothing at all', async () => {
    const client = fakeClient('');
    const result = await summariseSession(transcript, client);

    expect(result.summary).toMatch(/could not be summarised/i);
  });

  it('rejects a plan with more than five actions rather than truncating silently', async () => {
    const actions = Array.from({ length: 6 }, (_, i) => ({
      action: `action ${i}`,
      why: 'because',
      priority: 'low' as const,
    }));
    const client = fakeClient(JSON.stringify({ summary: 'ok', actions }));

    const result = await summariseSession(transcript, client);
    expect(result.actions).toEqual([]);
  });
});
