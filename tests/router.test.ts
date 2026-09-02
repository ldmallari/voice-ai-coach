import { describe, expect, it } from 'vitest';
import { classifyQuestion, describePath } from '@/lib/router';

describe('classifyQuestion', () => {
  it('routes data questions to the structured path', () => {
    expect(classifyQuestion('Why are some consultations not converting?')).toBe(
      'structured',
    );
    expect(classifyQuestion('Where are rebooking rates weak?')).toBe('structured');
    expect(classifyQuestion('Which customers have not returned recently?')).toBe(
      'structured',
    );
  });

  it('routes document questions to the knowledge path', () => {
    expect(classifyQuestion('What does our policy say about this?')).toBe('knowledge');
    expect(classifyQuestion('What does our uploaded SOP recommend?')).toBe('knowledge');
    expect(classifyQuestion('How should staff explain this treatment?')).toBe(
      'knowledge',
    );
  });

  it('uses both sources when a question spans data and documents', () => {
    expect(
      classifyQuestion('Our conversion is down, what does our consultation script say?'),
    ).toBe('both');
  });

  it('falls back to both rather than answering from model knowledge alone', () => {
    expect(classifyQuestion('How is the business doing?')).toBe('both');
  });

  it('is case-insensitive', () => {
    expect(classifyQuestion('WHY IS CONVERSION DOWN?')).toBe('structured');
  });
});

describe('describePath', () => {
  it('gives a citable label for every path', () => {
    expect(describePath('structured')).toContain('customer data');
    expect(describePath('knowledge')).toContain('documents');
    expect(describePath('both')).toContain('and');
  });
});
