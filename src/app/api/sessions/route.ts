import { NextResponse } from 'next/server';
import { sessionStore } from '@/lib/sessions';

/** Starts a coaching session and returns its id. */
export async function POST() {
  try {
    const id = await sessionStore().create();
    return NextResponse.json({ sessionId: id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[sessions] create failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
