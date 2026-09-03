import { describe, expect, it } from 'vitest';
import { isKnownTool, runTool, sourceForTool, TOOL_NAMES, type ToolContext } from '@/lib/tools';
import { generateCustomers } from '@/lib/synthetic';

/**
 * Unit tests for get_clinic_report — the consolidated data tool.
 *
 * The point of this tool is fewer agent round-trips WITHOUT changing any figures:
 * it must be byte-identical to composing the four granular tools. These tests
 * lock that guarantee in, so a future change can't silently alter the numbers.
 */

const NOW = new Date('2026-09-03T00:00:00Z');

function context(): ToolContext {
  return {
    records: generateCustomers(),
    // The report never touches knowledge; a throwing stub proves that.
    searchKnowledge: async () => {
      throw new Error('get_clinic_report must not call the knowledge store');
    },
    now: NOW,
  };
}

describe('get_clinic_report', () => {
  it('is a registered, known tool labelled as customer data', () => {
    expect(TOOL_NAMES).toContain('get_clinic_report');
    expect(isKnownTool('get_clinic_report')).toBe(true);
    expect(sourceForTool('get_clinic_report')).toBe('clinic customer data');
  });

  it('composes the four data tools with byte-identical figures', async () => {
    const ctx = context();
    const report = (await runTool('get_clinic_report', {}, ctx)) as Record<string, unknown>;

    expect(report.overview).toEqual(await runTool('get_clinic_overview', {}, ctx));
    expect(report.treatments).toEqual(await runTool('get_treatment_performance', {}, ctx));
    expect(report.providers).toEqual(await runTool('get_provider_performance', {}, ctx));
    expect(report.lapsed).toEqual(await runTool('get_lapsed_customers', { days: 90 }, ctx));
  });

  it('passes the lapsed window through to the lapsed section', async () => {
    const ctx = context();
    const report = (await runTool('get_clinic_report', { days: 30 }, ctx)) as {
      lapsed: { days: number };
    };
    expect(report.lapsed.days).toBe(30);
    expect(report.lapsed).toEqual(await runTool('get_lapsed_customers', { days: 30 }, ctx));
  });

  it('returns all four sections in one call (one round-trip, whole picture)', async () => {
    const report = (await runTool('get_clinic_report', {}, context())) as Record<string, unknown>;
    expect(Object.keys(report).sort()).toEqual(['lapsed', 'overview', 'providers', 'treatments']);
  });
});
