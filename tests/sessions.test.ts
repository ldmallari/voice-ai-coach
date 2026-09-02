import { describe, expect, it } from 'vitest';
import { inMemoryStore } from '@/lib/sessions';

describe('inMemoryStore', () => {
  it('creates sessions with distinct ids', async () => {
    const store = inMemoryStore();
    const a = await store.create();
    const b = await store.create();

    expect(a).not.toBe(b);
  });

  it('records turns in order', async () => {
    const store = inMemoryStore();
    const id = await store.create();

    await store.append(id, { role: 'user', content: 'Why is conversion down?', sources: [] });
    await store.append(id, {
      role: 'assistant',
      content: 'CoolSculpting is your weakest converter.',
      sources: ['clinic customer data'],
    });

    const transcript = await store.transcript(id);
    expect(transcript).toHaveLength(2);
    expect(transcript[0].role).toBe('user');
    expect(transcript[1].sources).toEqual(['clinic customer data']);
  });

  it('rejects appending to an unknown session', async () => {
    const store = inMemoryStore();
    await expect(
      store.append('does_not_exist', { role: 'user', content: 'hi', sources: [] }),
    ).rejects.toThrow(/Unknown session/);
  });

  it('returns an empty transcript for an unknown session rather than throwing', async () => {
    const store = inMemoryStore();
    expect(await store.transcript('nope')).toEqual([]);
  });

  it('keeps sessions separate', async () => {
    const store = inMemoryStore();
    const first = await store.create();
    const second = await store.create();

    await store.append(first, { role: 'user', content: 'one', sources: [] });

    expect(await store.transcript(first)).toHaveLength(1);
    expect(await store.transcript(second)).toHaveLength(0);
  });
});
