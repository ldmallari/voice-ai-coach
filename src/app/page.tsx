'use client';

import { useState } from 'react';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
}

const SUGGESTIONS = [
  'Why are some consultations not converting?',
  'Which treatment needs attention?',
  'Who has not returned recently?',
  'What does our consultation SOP recommend?',
];

export default function Home() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    setTurns((previous) => [...previous, { role: 'user', content: trimmed }]);
    setQuestion('');
    setPending(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = await response.json();

      setTurns((previous) => [
        ...previous,
        response.ok
          ? { role: 'assistant', content: data.answer, sources: data.sources }
          : { role: 'assistant', content: `Something went wrong: ${data.error}` },
      ]);
    } catch {
      setTurns((previous) => [
        ...previous,
        { role: 'assistant', content: 'Could not reach the coach. Please try again.' },
      ]);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-5 py-10">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Voice AI Coach</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Ask about your clinic. Answers come from your customer data and your own
          uploaded documents.
        </p>
      </header>

      {turns.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => ask(suggestion)}
              className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:border-neutral-500"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4">
        {turns.map((turn, index) => (
          <div
            key={index}
            className={
              turn.role === 'user'
                ? 'self-end rounded-2xl bg-neutral-900 px-4 py-2.5 text-sm text-white'
                : 'rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm'
            }
          >
            <p className="whitespace-pre-wrap">{turn.content}</p>
            {turn.sources && turn.sources.length > 0 && (
              <p className="mt-2 text-xs text-neutral-500">
                Source: {turn.sources.join(' and ')}
              </p>
            )}
          </div>
        ))}

        {pending && (
          <p className="text-sm text-neutral-500" aria-live="polite">
            Checking your clinic data…
          </p>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          ask(question);
        }}
        className="sticky bottom-4 flex gap-2"
      >
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask your coach a question"
          aria-label="Ask your coach a question"
          className="flex-1 rounded-full border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-neutral-900"
        />
        <button
          type="submit"
          disabled={pending || question.trim().length === 0}
          className="rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Ask
        </button>
      </form>
    </main>
  );
}
