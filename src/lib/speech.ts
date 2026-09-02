/**
 * Turns a coach answer into speakable chunks.
 *
 * Strips markdown, then groups whole sentences into pieces of ~240 characters.
 * Each chunk synthesises quickly and well under the request timeout, so a long
 * answer can be spoken in full — played chunk after chunk — even though the free
 * voice model renders slowly and would time out on the whole answer at once.
 */
export function chunksForSpeech(text: string, maxChars = 240): string[] {
  const clean = text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/[#>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return [];

  // Whole sentences (ending in . ! ?), plus any trailing fragment.
  const sentences = clean.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [clean];
  const chunks: string[] = [];
  let buf = '';
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (buf && (buf + ' ' + s).length > maxChars) {
      chunks.push(buf);
      buf = s;
    } else {
      buf = buf ? `${buf} ${s}` : s;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}
