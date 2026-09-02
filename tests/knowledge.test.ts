import { describe, expect, it } from 'vitest';
import { chunkText } from '@/lib/knowledge';

describe('chunkText', () => {
  it('returns a single chunk when the text is short', () => {
    expect(chunkText('Short policy note.', 1000)).toEqual(['Short policy note.']);
  });

  it('returns nothing for empty or whitespace-only input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n  ')).toEqual([]);
  });

  it('collapses whitespace so chunk sizes are predictable', () => {
    expect(chunkText('a\n\n  b\tc')).toEqual(['a b c']);
  });

  it('splits long text into overlapping chunks', () => {
    const text = 'x'.repeat(2500);
    const chunks = chunkText(text, 1000, 150);

    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(1000);
  });

  it('overlaps consecutive chunks so a sentence is not lost at a boundary', () => {
    // Distinct characters make the overlap visible.
    const text = Array.from({ length: 2000 }, (_, i) => String(i % 10)).join('');
    const chunks = chunkText(text, 1000, 150);
    const tail = chunks[0].slice(-150);

    expect(chunks[1].startsWith(tail)).toBe(true);
  });

  it('covers the whole input with no gaps', () => {
    const text = 'y'.repeat(3000);
    const chunks = chunkText(text, 1000, 150);
    // Every chunk after the first re-reads `overlap` characters.
    const covered = chunks.reduce((sum, c) => sum + c.length, 0) - 150 * (chunks.length - 1);

    expect(covered).toBe(3000);
  });
});
