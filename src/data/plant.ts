import { Decimal, dec, getCurrency, toDecimalString, type DecimalString } from '@/lib/money';

/**
 * Savings style F, "a plant that grows" (owner, Nov 20; canvas BGtyYQacuQaJyaFnCK6w2t).
 * Each goal grows from its own progress in its own currency:
 * Seed (nothing yet) → Sprout (from the first money) → Plant at 25% → Bush at 50% →
 * Tree at 75% → Fruit at 100%. A completed goal is a harvest basket.
 */
export type PlantStage = 'seed' | 'sprout' | 'plant' | 'bush' | 'tree' | 'fruit' | 'harvest';

/** Where each growing stage starts, as a share of the target. */
export const STAGE_MARKS: { stage: Exclude<PlantStage, 'seed' | 'sprout' | 'harvest'>; pct: number }[] = [
  { stage: 'plant', pct: 25 },
  { stage: 'bush', pct: 50 },
  { stage: 'tree', pct: 75 },
  { stage: 'fruit', pct: 100 },
];

export interface PlantView {
  stage: PlantStage;
  /** Whole percent of the target, 0–100 (rounded down, so 100 only when reached). */
  pct: number;
  /** The next stage and what's still needed to reach it, in the goal's currency; null at Fruit / harvest. */
  next: { stage: PlantStage; pct: number; toGo: DecimalString } | null;
}

/** The plant for a goal: from what it holds of its target, or a harvest once it's completed. */
export function plantFor(held: DecimalString, target: DecimalString, currency: string, completed = false): PlantView {
  const h = dec(held);
  const t = dec(target);
  const share = t.gt(0) ? h.dividedBy(t) : new Decimal(h.gt(0) ? 1 : 0);
  const pct = Math.min(100, share.times(100).floor().toNumber());
  if (completed) return { stage: 'harvest', pct, next: null };
  // Exact comparisons (held vs the share of the target), so a stage starts exactly at its mark.
  let stage: PlantStage = h.gt(0) ? 'sprout' : 'seed';
  for (const m of STAGE_MARKS) if (t.gt(0) && h.gte(t.times(m.pct).dividedBy(100))) stage = m.stage;
  if (t.lte(0) && h.gt(0)) stage = 'fruit';
  const mark = STAGE_MARKS.find((m) => t.gt(0) && h.lt(t.times(m.pct).dividedBy(100)));
  if (!mark || stage === 'fruit') return { stage, pct, next: null };
  // Rounded up to the currency's smallest unit, so adding exactly this reaches the next stage.
  const needed = t.times(mark.pct).dividedBy(100).toDecimalPlaces(getCurrency(currency).minorUnits, Decimal.ROUND_UP);
  return { stage, pct, next: { stage: mark.stage, pct: mark.pct, toGo: toDecimalString(needed.minus(h)) } };
}

/** The order stages grow in, for the "it grew" animation (only plays when this goes up). */
export function stageRank(stage: PlantStage): number {
  return ['seed', 'sprout', 'plant', 'bush', 'tree', 'fruit', 'harvest'].indexOf(stage);
}
