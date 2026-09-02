import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { coach, type CoachContext } from '@/lib/agent';
import { generateCustomers } from '@/lib/synthetic';

/**
 * The Anthropic API is mocked throughout. CI must never spend credit, and the
 * behaviour under test is our orchestration, not the model's wording.
 */

/** Builds a fake client that returns the given responses in order. */
function fakeClient(responses: unknown[]): Anthropic {
  const create = vi.fn();
  for (const response of responses) create.mockResolvedValueOnce(response);
  return { messages: { create } } as unknown as Anthropic;
}

function textResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

function toolResponse(name: string, input: Record<string, unknown> = {}) {
  return { content: [{ type: 'tool_use', id: `tool_${name}`, name, input }] };
}

function context(overrides: Partial<CoachContext> = {}): CoachContext {
  return {
    records: generateCustomers(),
    searchKnowledge: async () => [],
    now: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

describe('coach', () => {
  it('returns the model answer when no tools are needed', async () => {
    const client = fakeClient([textResponse('Conversion looks healthy.')]);
    const result = await coach('How is the business doing?', context(), client);

    expect(result.answer).toBe('Conversion looks healthy.');
    expect(result.toolCalls).toEqual([]);
  });

  it('runs a requested tool and feeds the result back to the model', async () => {
    const client = fakeClient([
      toolResponse('get_treatment_performance'),
      textResponse('CoolSculpting is your weakest converter.'),
    ]);

    const result = await coach('Which treatment needs attention?', context(), client);

    expect(result.toolCalls).toEqual(['get_treatment_performance']);
    expect(result.answer).toContain('CoolSculpting');
    // Two round trips: one to request the tool, one to answer with the result.
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it('computes tool figures in code, not in the model', async () => {
    const client = fakeClient([
      toolResponse('get_clinic_overview'),
      textResponse('done'),
    ]);

    await coach('Give me an overview', context(), client);

    // Inspect what was handed back to the model on the second call.
    const secondCall = (client.messages.create as ReturnType<typeof vi.fn>).mock
      .calls[1][0];
    const toolResult = secondCall.messages.at(-1).content[0];
    const payload = JSON.parse(toolResult.content);

    expect(payload.consultations).toBe(60);
    expect(payload.conversionRate).toBeGreaterThan(0);
    expect(payload.conversionRate).toBeLessThanOrEqual(1);
  });

  it('cites the customer data source when a data tool ran', async () => {
    const client = fakeClient([
      toolResponse('get_provider_performance'),
      textResponse('Nurse Kahu converts lowest.'),
    ]);

    const result = await coach('Who needs coaching?', context(), client);
    expect(result.sources).toContain('clinic customer data');
  });

  it('cites the document source when knowledge search ran', async () => {
    const searchKnowledge = vi.fn(async () => [
      { title: 'Consultation SOP', content: 'Always confirm pricing.', similarity: 0.8 },
    ]);
    const client = fakeClient([
      toolResponse('search_clinic_knowledge', { query: 'consultation script' }),
      textResponse('Your SOP says to confirm pricing.'),
    ]);

    const result = await coach('What does our SOP recommend?', context({ searchKnowledge }), client);

    expect(searchKnowledge).toHaveBeenCalledWith('consultation script');
    expect(result.sources).toContain('uploaded clinic documents');
  });

  it('tells the model when no documents match instead of returning silence', async () => {
    const client = fakeClient([
      toolResponse('search_clinic_knowledge', { query: 'refund policy' }),
      textResponse('Nothing in your documents covers refunds.'),
    ]);

    await coach('What is our refund policy?', context(), client);

    const secondCall = (client.messages.create as ReturnType<typeof vi.fn>).mock
      .calls[1][0];
    const payload = JSON.parse(secondCall.messages.at(-1).content[0].content);
    expect(payload.note).toMatch(/No matching content/i);
  });

  it('stops and says so when the model loops without answering', async () => {
    // Failure case: the model keeps calling tools and never produces text.
    const client = fakeClient([
      toolResponse('get_clinic_overview'),
      toolResponse('get_clinic_overview'),
      toolResponse('get_clinic_overview'),
    ]);

    const result = await coach('Why is revenue down?', context(), client, 3);

    expect(result.answer).toMatch(/could not settle on an answer/i);
    expect(result.toolCalls).toHaveLength(3);
    // Bounded: it did not keep calling past the limit.
    expect(client.messages.create).toHaveBeenCalledTimes(3);
  });

  it('surfaces an unknown tool as an error rather than crashing the turn', async () => {
    const client = fakeClient([
      toolResponse('get_something_that_does_not_exist'),
      textResponse('recovered'),
    ]);

    const result = await coach('Anything', context(), client);

    const secondCall = (client.messages.create as ReturnType<typeof vi.fn>).mock
      .calls[1][0];
    const payload = JSON.parse(secondCall.messages.at(-1).content[0].content);
    expect(payload.error).toMatch(/Unknown tool/);
    expect(result.answer).toBe('recovered');
  });
});
