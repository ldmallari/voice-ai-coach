'use client';

import { useEffect, useRef, useState } from 'react';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
}

interface ActionItem {
  action: string;
  why: string;
  priority: 'high' | 'medium' | 'low';
}

interface Plan {
  summary: string;
  actions: ActionItem[];
}

const SUGGESTIONS = [
  'Why are some consultations not converting?',
  'Which treatment needs attention?',
  'Who has not returned recently?',
  'What does our cancellation policy say?',
];

const PRIORITY_STYLE: Record<ActionItem['priority'], string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-neutral-200 text-neutral-600',
};

export default function Home() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [ending, setEnding] = useState(false);

  const [autoSpeak, setAutoSpeak] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, plan]);

  /** Lazily creates a session so every conversation is saved and can be summarised. */
  async function ensureSession(): Promise<string | null> {
    if (sessionId) return sessionId;
    try {
      const response = await fetch('/api/sessions', { method: 'POST' });
      if (!response.ok) return null;
      const data = await response.json();
      setSessionId(data.sessionId);
      return data.sessionId as string;
    } catch {
      return null;
    }
  }

  async function speak(text: string) {
    try {
      setSpeaking(true);
      const response = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.src = url;
        await audioRef.current.play().catch(() => undefined);
      }
    } catch {
      /* voice output is best-effort */
    } finally {
      setSpeaking(false);
    }
  }

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    const id = await ensureSession();
    setTurns((previous) => [...previous, { role: 'user', content: trimmed }]);
    setQuestion('');
    setPending(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed, sessionId: id ?? undefined }),
      });
      const data = await response.json();

      if (response.ok) {
        setTurns((previous) => [
          ...previous,
          { role: 'assistant', content: data.answer, sources: data.sources },
        ]);
        if (autoSpeak) void speak(data.answer);
      } else {
        setTurns((previous) => [
          ...previous,
          { role: 'assistant', content: `Something went wrong: ${data.error}` },
        ]);
      }
    } catch {
      setTurns((previous) => [
        ...previous,
        { role: 'assistant', content: 'Could not reach the coach. Please try again.' },
      ]);
    } finally {
      setPending(false);
    }
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size === 0) return;

        setTranscribing(true);
        try {
          const form = new FormData();
          form.append('audio', blob, 'question.webm');
          const response = await fetch('/api/voice/transcribe', { method: 'POST', body: form });
          const data = await response.json();
          if (response.ok && data.text) await ask(data.text);
        } catch {
          /* transcription is best-effort; the owner can type instead */
        } finally {
          setTranscribing(false);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setUploadMsg('Microphone access was blocked.');
    }
  }

  async function endSession() {
    if (!sessionId || ending) return;
    setEnding(true);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/end`, { method: 'POST' });
      const data = await response.json();
      if (response.ok) setPlan({ summary: data.summary, actions: data.actions ?? [] });
    } catch {
      /* keep the transcript; summary can be retried */
    } finally {
      setEnding(false);
    }
  }

  async function uploadDocument(file: File) {
    setUploading(true);
    setUploadMsg(`Uploading ${file.name}…`);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/documents', { method: 'POST', body: form });
      const data = await response.json();
      setUploadMsg(
        response.ok
          ? `Added “${data.title}” to the knowledge base (${data.characters.toLocaleString()} characters).`
          : `Upload failed: ${data.error}`,
      );
    } catch {
      setUploadMsg('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  const canEnd = turns.length > 0 && !plan;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-5 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Voice AI Coach</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Ask about your clinic by voice or text. Answers come from your customer
            data and your own uploaded documents.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-neutral-600">
          <input
            type="checkbox"
            checked={autoSpeak}
            onChange={(event) => setAutoSpeak(event.target.checked)}
          />
          Speak answers
        </label>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3">
        <label className="cursor-pointer rounded-full bg-neutral-100 px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-200">
          {uploading ? 'Uploading…' : '+ Upload PDF / TXT'}
          <input
            type="file"
            accept=".pdf,.txt,application/pdf,text/plain"
            className="hidden"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadDocument(file);
              event.target.value = '';
            }}
          />
        </label>
        {uploadMsg && <span className="text-xs text-neutral-500">{uploadMsg}</span>}
      </div>

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

        {(pending || transcribing || speaking) && (
          <p className="text-sm text-neutral-500" aria-live="polite">
            {transcribing
              ? 'Transcribing your question…'
              : pending
                ? 'Checking your clinic data…'
                : 'Speaking…'}
          </p>
        )}

        {plan && (
          <section className="rounded-2xl border border-neutral-900/10 bg-neutral-50 p-4">
            <h2 className="text-sm font-semibold text-neutral-900">Session action plan</h2>
            <p className="mt-1 text-sm text-neutral-700">{plan.summary}</p>
            <ol className="mt-3 space-y-2">
              {plan.actions.map((item, index) => (
                <li key={index} className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-neutral-900">{item.action}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLE[item.priority]}`}>
                      {item.priority}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">{item.why}</p>
                </li>
              ))}
            </ol>
          </section>
        )}

        <div ref={bottomRef} />
      </div>

      {canEnd && (
        <button
          onClick={endSession}
          disabled={ending}
          className="self-start text-xs font-medium text-neutral-500 underline underline-offset-4 disabled:opacity-40"
        >
          {ending ? 'Summarising…' : 'End session & get action plan'}
        </button>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          ask(question);
        }}
        className="sticky bottom-4 flex gap-2"
      >
        <button
          type="button"
          onClick={toggleRecording}
          aria-label={recording ? 'Stop recording' : 'Ask by voice'}
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border text-lg transition ${
            recording
              ? 'animate-pulse border-red-500 bg-red-500 text-white'
              : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500'
          }`}
        >
          {recording ? '■' : '🎙'}
        </button>
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={recording ? 'Listening…' : 'Ask your coach a question'}
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

      <audio ref={audioRef} className="hidden" />
    </main>
  );
}
