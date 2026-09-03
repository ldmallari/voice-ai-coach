'use client';

import { useEffect, useRef, useState } from 'react';
import { chunksForSpeech } from '@/lib/speech';

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
  'Which treatment needs attention?',
  'Why are some consultations not converting?',
  'Who has not returned recently?',
  'What does our cancellation policy say?',
];

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onerror: () => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};

/** The browser's speech recognition, when available: instant, free, no Fish credit needed. */
function getSpeechRecognition(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

/** Renders bold and italic spans within one line of the coach's answer. */
function renderInline(line: string) {
  return line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
      return <em key={i}>{part.slice(1, -1)}</em>;
    return <span key={i}>{part}</span>;
  });
}

/** Light renderer for the answer: paragraphs, bullets and bold. Our own model output, so no injection surface. */
function RichText({ content }: { content: string }) {
  return (
    <div className="cx-answer">
      {content.split('\n').map((line, i) => {
        const t = line.trim();
        if (!t) return null;
        if (/^[-*]\s+/.test(t)) {
          return (
            <div key={i} className="cx-md-li">
              <span className="b">•</span>
              <span>{renderInline(t.replace(/^[-*]\s+/, ''))}</span>
            </div>
          );
        }
        return (
          <p key={i} className="cx-md-p">
            {renderInline(t)}
          </p>
        );
      })}
    </div>
  );
}

const SpeakerOn = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 5 6 9H3v6h3l5 4z" />
    <path d="M16 9a3.5 3.5 0 0 1 0 6" />
    <path d="M19 6.5a7 7 0 0 1 0 11" />
  </svg>
);
const SpeakerOff = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 5 6 9H3v6h3l5 4z" />
    <path d="m17 9 5 5M22 9l-5 5" />
  </svg>
);
const UploadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 15V3" />
    <path d="m7 8 5-5 5 5" />
    <path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
  </svg>
);
const KnowledgeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2z" />
    <path d="M8 3v18" />
  </svg>
);
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
  </svg>
);
const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 6 6 6-6 6" />
  </svg>
);
const BackIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 6-6 6 6 6" />
  </svg>
);

interface StoredDocument {
  title: string;
  chunks: number;
  uploadedAt: string | null;
}

/** Formats an ISO upload timestamp as a short "Sep 3, 2026", or null when unknown. */
function formatAdded(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

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

  const [kbOpen, setKbOpen] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [kbUnlocked, setKbUnlocked] = useState(false);
  const [docs, setDocs] = useState<StoredDocument[] | null>(null);
  const [kbBusy, setKbBusy] = useState(false);
  const [kbError, setKbError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [viewContent, setViewContent] = useState<string | null>(null);
  const [viewBusy, setViewBusy] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);

  const [overview, setOverview] = useState<{
    conversion: number;
    rebooking: number;
    revenue: number;
    retention90: number;
  } | null>(null);
  const [streaming, setStreaming] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const revealRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const speakTokenRef = useRef<{ cancelled: boolean } | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, plan, pending]);

  useEffect(() => {
    fetch('/api/overview')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setOverview(d))
      .catch(() => undefined);
    return () => {
      if (revealRef.current) clearTimeout(revealRef.current);
      if (speakTokenRef.current) speakTokenRef.current.cancelled = true;
    };
  }, []);

  /** Fills an assistant turn word-by-word so answers feel alive rather than landing as a block. */
  function revealAnswer(full: string, sources: string[]) {
    if (revealRef.current) clearTimeout(revealRef.current);
    setTurns((p) => [...p, { role: 'assistant', content: '', sources }]);
    const parts = full.split(/(\s+)/);
    let i = 0;
    setStreaming(true);
    const step = () => {
      i = Math.min(i + 3, parts.length);
      const partial = parts.slice(0, i).join('');
      setTurns((p) => {
        const copy = [...p];
        const last = copy[copy.length - 1];
        if (last && last.role === 'assistant') copy[copy.length - 1] = { ...last, content: partial };
        return copy;
      });
      if (i < parts.length) {
        revealRef.current = setTimeout(step, 16);
      } else {
        setStreaming(false);
        revealRef.current = null;
      }
    };
    step();
  }

  async function ensureSession(): Promise<string | null> {
    if (sessionId) return sessionId;
    try {
      const res = await fetch('/api/sessions', { method: 'POST' });
      if (!res.ok) return null;
      const data = await res.json();
      setSessionId(data.sessionId);
      return data.sessionId as string;
    } catch {
      return null;
    }
  }

  /** Stops any in-progress speech and cancels its queue. */
  function stopSpeaking() {
    if (speakTokenRef.current) speakTokenRef.current.cancelled = true;
    audioRef.current?.pause();
    setSpeaking(false);
  }

  /** Synthesises one chunk; returns a playable object URL, or null on failure. */
  async function fetchSpeech(text: string): Promise<string | null> {
    try {
      const res = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return null;
      return URL.createObjectURL(await res.blob());
    } catch {
      return null;
    }
  }

  /** Plays one audio URL to completion (resolves on end, error, or an external pause). */
  function playUrl(url: string): Promise<void> {
    return new Promise((resolve) => {
      const a = audioRef.current;
      if (!a) {
        resolve();
        return;
      }
      const done = () => {
        a.removeEventListener('ended', done);
        a.removeEventListener('pause', done);
        a.removeEventListener('error', done);
        URL.revokeObjectURL(url);
        resolve();
      };
      a.addEventListener('ended', done);
      a.addEventListener('pause', done);
      a.addEventListener('error', done);
      a.src = url;
      void a.play().catch(() => done());
    });
  }

  /**
   * Speaks the whole answer by synthesising and playing it chunk by chunk, so a
   * long answer is read in full (a single long request would hit the timeout).
   * One chunk is prefetched ahead so playback stays gapless.
   */
  async function speak(text: string) {
    stopSpeaking();
    const token = { cancelled: false };
    speakTokenRef.current = token;

    const chunks = chunksForSpeech(text);
    if (chunks.length === 0) return;

    setSpeaking(true);
    try {
      let next = fetchSpeech(chunks[0]);
      for (let i = 0; i < chunks.length; i += 1) {
        const url = await next;
        if (token.cancelled) break;
        next = i + 1 < chunks.length ? fetchSpeech(chunks[i + 1]) : Promise.resolve(null);
        if (url) await playUrl(url);
        if (token.cancelled) break;
      }
    } finally {
      if (speakTokenRef.current === token) setSpeaking(false);
    }
  }

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    stopSpeaking();
    const id = await ensureSession();
    setTurns((p) => [...p, { role: 'user', content: trimmed }]);
    setQuestion('');
    setPending(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed, sessionId: id ?? undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        revealAnswer(data.answer, data.sources ?? []);
        if (autoSpeak) void speak(data.answer);
      } else {
        setTurns((p) => [...p, { role: 'assistant', content: `Something went wrong: ${data.error}` }]);
      }
    } catch {
      setTurns((p) => [...p, { role: 'assistant', content: 'Could not reach the coach. Please try again.' }]);
    } finally {
      setPending(false);
    }
  }

  async function toggleRecording() {
    if (recording) {
      recognitionRef.current?.stop();
      recorderRef.current?.stop();
      return;
    }

    stopSpeaking();
    const recognition = getSpeechRecognition();
    if (recognition) {
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        const t = event.results[0]?.[0]?.transcript ?? '';
        if (t) void ask(t);
      };
      recognition.onerror = () => setRecording(false);
      recognition.onend = () => setRecording(false);
      recognitionRef.current = recognition;
      recognition.start();
      setRecording(true);
      return;
    }

    // Fallback: record and send to the Fish Audio ASR endpoint.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size === 0) return;
        setTranscribing(true);
        try {
          const form = new FormData();
          form.append('audio', blob, 'question.webm');
          const res = await fetch('/api/voice/transcribe', { method: 'POST', body: form });
          const data = await res.json();
          if (res.ok && data.text) await ask(data.text);
        } catch {
          /* transcription is best-effort */
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
      const res = await fetch(`/api/sessions/${sessionId}/end`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) setPlan({ summary: data.summary, actions: data.actions ?? [] });
    } catch {
      /* transcript is kept; summary can be retried */
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
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'x-admin-passcode': passcode },
        body: form,
      });
      const data = await res.json();
      if (res.ok) {
        setUploadMsg(`Added “${data.title}” to the knowledge base.`);
        void refreshDocs();
      } else {
        setUploadMsg(`Upload failed: ${data.error}`);
      }
    } catch {
      setUploadMsg('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  /** Fetches the document list using the admin passcode; throws on a rejected code. */
  async function fetchDocs(code: string): Promise<StoredDocument[]> {
    const res = await fetch('/api/documents', { headers: { 'x-admin-passcode': code } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Failed (${res.status}).`);
    return (data.documents ?? []) as StoredDocument[];
  }

  async function unlockKb() {
    if (!passcode.trim() || kbBusy) return;
    setKbBusy(true);
    setKbError(null);
    try {
      setDocs(await fetchDocs(passcode));
      setKbUnlocked(true);
    } catch (error) {
      setKbError(error instanceof Error ? error.message : 'Could not unlock.');
    } finally {
      setKbBusy(false);
    }
  }

  async function refreshDocs() {
    if (!kbUnlocked) return;
    try {
      setDocs(await fetchDocs(passcode));
    } catch {
      /* keep the current list on a transient failure */
    }
  }

  function closeKb() {
    setKbOpen(false);
    setPendingDelete(null);
    setKbError(null);
    closeView();
  }

  /** Opens a document and loads its stored text (the chunks the coach ingested). */
  async function viewDoc(title: string) {
    setViewing(title);
    setViewContent(null);
    setViewError(null);
    setViewBusy(true);
    try {
      const res = await fetch(`/api/documents?title=${encodeURIComponent(title)}`, {
        headers: { 'x-admin-passcode': passcode },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status}).`);
      setViewContent(data.content ?? '');
    } catch (error) {
      setViewError(error instanceof Error ? error.message : 'Could not load the document.');
    } finally {
      setViewBusy(false);
    }
  }

  function closeView() {
    setViewing(null);
    setViewContent(null);
    setViewError(null);
  }

  async function removeDoc(title: string) {
    if (kbBusy) return;
    setKbBusy(true);
    try {
      const res = await fetch(`/api/documents?title=${encodeURIComponent(title)}`, {
        method: 'DELETE',
        headers: { 'x-admin-passcode': passcode },
      });
      if (res.ok) setDocs((current) => (current ?? []).filter((d) => d.title !== title));
    } catch {
      /* leave the list unchanged on failure */
    } finally {
      setKbBusy(false);
    }
  }

  const empty = turns.length === 0;
  const canEnd = turns.length > 0 && !plan;
  const statusText = transcribing ? 'Transcribing…' : pending ? 'Coaching…' : speaking ? 'Speaking…' : null;

  return (
    <div className="cx-page">
      <header className="cx-head">
        <div className="cx-brand">
          <span className={`dot${pending || speaking ? ' pulsing' : ''}`} />
          Voice AI Coach
        </div>
        <span className="grow" />
        <button
          type="button"
          className={`cx-ctrl${autoSpeak ? ' on' : ''}`}
          role="switch"
          aria-checked={autoSpeak}
          onClick={() => setAutoSpeak((v) => !v)}
        >
          {autoSpeak ? <SpeakerOn /> : <SpeakerOff />}
          <span className="lab">Speak answers</span>
          <span className="cx-switch" aria-hidden="true">
            <span className="knob" />
          </span>
        </button>
        <button type="button" className="cx-ctrl" onClick={() => setKbOpen(true)}>
          <KnowledgeIcon />
          <span className="lab">Knowledge base</span>
        </button>
      </header>

      <main className="cx-main">
        {empty ? (
          <div className="cx-hero">
            <div className="cx-orb-wrap">
              <span className="cx-orb-glow" />
              <button className="cx-orb" onClick={toggleRecording} aria-label="Hold to talk" />
            </div>
            <div className="cx-eyebrow">Your clinic coach</div>
            <h1 className="cx-hero-title">Ask your clinic anything.</h1>
            <p className="cx-hero-sub">
              By voice or text — answers come from your customer data and your own uploaded documents.
            </p>
            {overview && (
              <div className="cx-kpis" aria-label="Clinic overview">
                <div className="cx-kpi">
                  <span className="v">{Math.round(overview.conversion * 100)}%</span>
                  <span className="l">Conversion</span>
                </div>
                <div className="cx-kpi">
                  <span className="v">{Math.round(overview.rebooking * 100)}%</span>
                  <span className="l">Rebooking</span>
                </div>
                <div className="cx-kpi">
                  <span className="v">${Math.round(overview.revenue / 1000)}k</span>
                  <span className="l">Revenue</span>
                </div>
                <div className="cx-kpi">
                  <span className="v">{Math.round(overview.retention90 * 100)}%</span>
                  <span className="l">Retention</span>
                </div>
              </div>
            )}
            <div className="cx-chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="cx-chip" onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="cx-thread">
            {turns.map((turn, i) =>
              turn.role === 'user' ? (
                <div key={i} className="cx-turn user">
                  {turn.content}
                </div>
              ) : (
                <div key={i} className="cx-turn assistant">
                  <div className="who">
                    <span className="dot" />
                    <span>Coach</span>
                  </div>
                  <RichText content={turn.content} />
                  {i === turns.length - 1 && streaming && <span className="cx-caret" aria-hidden />}
                  {turn.sources &&
                    turn.sources.length > 0 &&
                    !(i === turns.length - 1 && streaming) && (
                      <span className="cx-src">
                        <span className="d" />
                        {turn.sources.join(' · ')}
                      </span>
                    )}
                </div>
              ),
            )}

            {statusText && (
              <div className="cx-status" aria-live="polite">
                <span className="dots">
                  <i />
                  <i />
                  <i />
                </span>
                {statusText}
              </div>
            )}

            {plan && (
              <section className="cx-plan">
                <h2>Session action plan</h2>
                <p className="sum">{plan.summary}</p>
                <ol>
                  {plan.actions.map((a, i) => (
                    <li key={i}>
                      <div className="top">
                        <span className="act">{a.action}</span>
                        <span className={`cx-pri ${a.priority}`}>{a.priority}</span>
                      </div>
                      <div className="why">{a.why}</div>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {canEnd && (
              <button className="cx-endbtn" onClick={endSession} disabled={ending}>
                {ending ? 'Summarising…' : 'End session & get action plan'}
              </button>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </main>

      <div className="cx-dock">
        <form
          className={`cx-composer${recording ? ' listening' : ''}`}
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
        >
          <button type="button" className="cx-omic" onClick={toggleRecording} aria-label="Hold to talk" />
          <input
            className="cx-field"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Type a message, or tap the orb to speak…"
            aria-label="Ask your coach a question"
          />
          <span className="cx-voicing">
            <span className="cx-wave">
              <i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
            </span>
            <span className="cx-lbl">Listening…</span>
          </span>
          <button type="submit" className="cx-send" disabled={pending || question.trim().length === 0}>
            Ask
          </button>
        </form>
      </div>

      {kbOpen && (
        <div className="cx-modal-backdrop" onClick={closeKb}>
          <div
            className="cx-modal"
            role="dialog"
            aria-label="Knowledge base"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cx-modal-head">
              <h2>Knowledge base</h2>
              <button className="cx-modal-close" onClick={closeKb} aria-label="Close">
                ✕
              </button>
            </div>

            {!kbUnlocked ? (
              <div className="cx-kb-section">
                <p className="cx-kb-intro">
                  Your knowledge base is private. Enter the passcode to add, view, and manage your
                  clinic&rsquo;s documents.
                </p>
                <form
                  className="cx-kb-lock"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void unlockKb();
                  }}
                >
                  <input
                    className="cx-passcode"
                    type="password"
                    inputMode="numeric"
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    placeholder="Admin passcode"
                    aria-label="Admin passcode"
                    autoFocus
                  />
                  <button type="submit" className="cx-send" disabled={kbBusy || !passcode.trim()}>
                    {kbBusy ? 'Checking…' : 'Unlock'}
                  </button>
                </form>
                {kbError && <p className="cx-kb-error">{kbError}</p>}
              </div>
            ) : viewing ? (
              <div className="cx-kb-section">
                <button className="cx-kb-back" onClick={closeView}>
                  <BackIcon />
                  All documents
                </button>
                <div className="cx-view-title">{viewing}</div>
                {viewBusy ? (
                  <p className="cx-kb-empty">Loading…</p>
                ) : viewError ? (
                  <p className="cx-kb-error">{viewError}</p>
                ) : (viewContent ?? '').trim().length === 0 ? (
                  <p className="cx-kb-empty">This document has no readable text.</p>
                ) : (
                  <div className="cx-view-body">{viewContent}</div>
                )}
              </div>
            ) : (
              <>
                <div className="cx-kb-section">
                  <div className="cx-kb-label">Add a document</div>
                  <label className={`cx-upload-drop${uploading ? ' busy' : ''}`}>
                    <UploadIcon />
                    <span>
                      {uploading ? 'Uploading…' : 'Upload a PDF or TXT — re-uploading replaces it'}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.txt,application/pdf,text/plain"
                      disabled={uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadDocument(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {uploadMsg && <p className="cx-upmsg">{uploadMsg}</p>}
                </div>

                <div className="cx-kb-section">
                  <div className="cx-kb-label">
                    Documents{docs ? ` (${docs.length})` : ''}
                  </div>
                  {(docs ?? []).length === 0 ? (
                    <p className="cx-kb-empty">No documents in the knowledge base yet.</p>
                  ) : (
                    <div className="cx-doclist">
                      {(docs ?? []).map((d) => {
                        const added = formatAdded(d.uploadedAt);
                        return (
                          <div key={d.title} className="cx-docitem">
                            <button
                              className="cx-docmain"
                              onClick={() => viewDoc(d.title)}
                              disabled={kbBusy}
                              aria-label={`View ${d.title}`}
                            >
                              <span className="cx-docmeta">
                                <span className="t">{d.title}</span>
                                <span className="s">
                                  {d.chunks} chunk{d.chunks === 1 ? '' : 's'}
                                  {added && ` · Added ${added}`}
                                </span>
                              </span>
                              <span className="cx-docchev" aria-hidden="true">
                                <ChevronIcon />
                              </span>
                            </button>
                            {pendingDelete === d.title ? (
                              <div className="cx-confirm">
                                <span className="q">Delete?</span>
                                <button
                                  className="cx-confirm-yes"
                                  onClick={() => {
                                    setPendingDelete(null);
                                    void removeDoc(d.title);
                                  }}
                                  disabled={kbBusy}
                                >
                                  Delete
                                </button>
                                <button
                                  className="cx-confirm-no"
                                  onClick={() => setPendingDelete(null)}
                                  disabled={kbBusy}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                className="cx-trash"
                                onClick={() => setPendingDelete(d.title)}
                                disabled={kbBusy}
                                aria-label={`Delete ${d.title}`}
                              >
                                <TrashIcon />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {kbError && <p className="cx-kb-error">{kbError}</p>}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <audio ref={audioRef} hidden />
    </div>
  );
}
