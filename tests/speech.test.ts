import { describe, expect, it } from 'vitest';
import { chunksForSpeech } from '@/lib/speech';

/** A realistic, long, markdown-laden coach answer. */
const LONG_ANSWER = `**CoolSculpting needs attention — clearly.** Here's what your data shows:

- CoolSculpting had **14 consultations** — the *most* of any treatment.
- But it converted at just **7.1%**, versus a 51.7% clinic average.
- Of the few who bought, **0% rebooked**, and satisfaction was **3.0**, the lowest.
- It is your **highest-ticket** treatment at ~$1,687 average spend.

What this tells you: the leak is not marketing — you are attracting the most
interest and losing nearly everyone during the consult. Next action: sit in on
the next three CoolSculpting consultations and note where interest drops.`;

describe('chunksForSpeech', () => {
  it('splits a long answer into multiple speakable chunks', () => {
    const chunks = chunksForSpeech(LONG_ANSWER);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('keeps every chunk within the synthesis budget', () => {
    // Slightly above maxChars is fine (a single long sentence can exceed it),
    // but nothing should approach the length that timed the voice model out.
    for (const chunk of chunksForSpeech(LONG_ANSWER, 240)) {
      expect(chunk.length).toBeLessThan(320);
    }
  });

  it('strips markdown so asterisks and bullets are not read aloud', () => {
    const joined = chunksForSpeech(LONG_ANSWER).join(' ');
    expect(joined).not.toMatch(/[*#`]/);
    expect(joined).toContain('CoolSculpting needs attention');
    expect(joined).toContain('highest-ticket');
  });

  it('returns a single chunk for a short answer and nothing for empty input', () => {
    expect(chunksForSpeech('Rebooking is weak on facials.')).toHaveLength(1);
    expect(chunksForSpeech('   ')).toEqual([]);
  });
});
