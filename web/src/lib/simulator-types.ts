/**
 * JSON schema for tariff simulators.
 *
 * Each tarif fiche in /tarifs-sacem/<slug>/ has an optional sibling
 * /src/data/simulators/<slug>.json that describes:
 *   - the questions to ask the user (activity-specific)
 *   - the compute tree that maps answers to a precise SACEM figure
 *   - how the SPRE is layered on top
 *
 * The schema is expressive enough to cover every SACEM barème we have
 * without us ever having to add per-slug logic in React: the engine
 * interprets the JSON uniformly.
 */

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export type QuestionType = "number" | "radio" | "select" | "boolean";

export interface QuestionOption {
  value: string | number | boolean;
  label: string;
}

export interface Question {
  id: string;
  label: string;
  help?: string;
  type: QuestionType;
  /** Initial value; required for number, optional for the others. */
  default?: string | number | boolean;
  /** For number questions. */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** For radio / select. */
  options?: QuestionOption[];
  /** Only show this question when another answer matches. */
  when?: Condition;
}

// ---------------------------------------------------------------------------
// Conditions (used both to gate questions and to match grid rows)
// ---------------------------------------------------------------------------

export type ConditionClause =
  | { eq: string | number | boolean }
  | { ne: string | number | boolean }
  | { in: (string | number | boolean)[] }
  | { lte: number }
  | { lt: number }
  | { gte: number }
  | { gt: number };

/**
 * Map of answer-id => clause. All clauses must match for the condition to be
 * satisfied. A plain scalar value means { eq: value } for convenience.
 */
export type Condition = Record<string, ConditionClause | string | number | boolean>;

// ---------------------------------------------------------------------------
// Compute tree
// ---------------------------------------------------------------------------

export type Compute =
  | LookupCompute
  | PercentageCompute
  | FormulaCompute
  | CompositeCompute
  | ConstantCompute;

/**
 * All compute nodes may carry post-modifiers (multiply/add/min/max)
 * which are applied after the raw value is computed. Typical use:
 *   - tarif réduit: multiply by 0.8 when the checkbox is on
 *   - abattement CA: multiply by 0.85 when revenue is under a threshold
 *   - star multiplier on camping forfait
 */
export interface ConstantCompute {
  kind: "constant";
  value: number;
  modifiers?: Modifier[];
}

/**
 * Lookup: find the first row whose `match` condition is satisfied, return its
 * `value`. Optional `fallback` if no row matches.
 */
export interface LookupRow {
  match: Condition;
  /** Constant value returned when the row matches. */
  value?: number;
  /** Alternative: a formula evaluated against the current answers. Useful
   * for per-unit pricing (e.g. `111.39 * appareils_simples`). */
  formula?: string;
}

export interface LookupCompute {
  kind: "lookup";
  rows: LookupRow[];
  fallback?: number;
  modifiers?: Modifier[];
}

/**
 * Percentage: rate * input (where input is an answer id resolved at runtime).
 * Optional minimum floor.
 */
export interface PercentageCompute {
  kind: "percentage";
  rate: number;
  of: string;
  min?: number;
  modifiers?: Modifier[];
}

/**
 * Formula: a tiny expression language with answer references (e.g. `places`)
 * and numeric literals. Supports + - * / min() max() and parentheses.
 * Intentionally limited so the JSON stays readable and safe to evaluate.
 */
export interface FormulaCompute {
  kind: "formula";
  expr: string;
  min?: number;
  modifiers?: Modifier[];
}

/**
 * Composite: run several sub-computes and combine them.
 *  - sum:      add all results
 *  - max:      take the largest
 *  - highestPlusFractionOfLower: SACEM's combination rule for appareils mixes
 */
export interface CompositeCompute {
  kind: "composite";
  op: "sum" | "max" | "highestPlusFractionOfLower";
  parts: Compute[];
  /** Only for highestPlusFractionOfLower. Fraction of the lower term(s). */
  fraction?: number;
  /** Post-result modifiers (multiplier, cap, floor) evaluated in order. */
  modifiers?: Modifier[];
}

export interface Modifier {
  kind: "multiply" | "add" | "min" | "max";
  value: number;
  /** Apply only when the condition matches. */
  when?: Condition;
}

// ---------------------------------------------------------------------------
// SPRE
// ---------------------------------------------------------------------------

/**
 * SPRE configuration.
 *
 * Uses the same Compute tree as the SACEM. The SACEM result is injected as
 * a pseudo-answer named `sacem`, so a typical SPRE at 65 % of the SACEM can
 * be expressed as:
 *
 *   { kind: "formula", expr: "sacem * 0.65", min: 110.60 }
 *
 * A tiered SPRE (e.g. salon de coiffure where SPRE is by number of
 * employees) can use the lookup kind directly.
 */
export interface SPRE {
  compute: Compute;
  /** When the SPRE should not apply (e.g., live music only). */
  skipWhen?: Condition;
}

// ---------------------------------------------------------------------------
// Top-level fiche simulator
// ---------------------------------------------------------------------------

export interface FicheSimulator {
  slug: string;
  activity: string;
  /** One-line help shown above the first question. */
  intro?: string;
  questions: Question[];
  /** SACEM compute tree. */
  compute: Compute;
  /** SPRE layered on the SACEM figure. */
  spre?: SPRE;
  /** Legal caveat or precision displayed after the result. */
  footnote?: string;
}

// ---------------------------------------------------------------------------
// Simulator output
// ---------------------------------------------------------------------------

export interface Scenario {
  /** Annual SACEM + SPRE (or SACEM alone) in €. */
  totalAnnual: number;
  /** Months to break even vs PlaySafe's one-time fee. */
  breakevenMonths: number;
  /** Savings at 5, 10, 15 years horizons. */
  savings: { horizon: 5 | 10 | 15; amount: number }[];
}

export interface SimulatorResult {
  sacem: number;
  spre: number;
  /** Conservative: SACEM + SPRE both due (current SPRE official position). */
  withSpre: Scenario;
  /** SACEM only: if PlaySafe's L. 213-1 / L. 214-1 reading prevails. */
  withoutSpre: Scenario;
}
