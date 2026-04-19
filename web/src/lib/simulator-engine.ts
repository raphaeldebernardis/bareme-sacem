import type {
  Compute,
  Condition,
  ConditionClause,
  FicheSimulator,
  Modifier,
  Question,
  Scenario,
  SimulatorResult,
} from "./simulator-types";

export const PLAYSAFE_PRICE_HT = 450;

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

function clauseMatches(
  clause: ConditionClause | string | number | boolean,
  value: unknown
): boolean {
  if (
    typeof clause === "string" ||
    typeof clause === "number" ||
    typeof clause === "boolean"
  ) {
    return value === clause;
  }
  if ("eq" in clause) return value === clause.eq;
  if ("ne" in clause) return value !== clause.ne;
  if ("in" in clause) return clause.in.includes(value as any);
  if ("lte" in clause) return typeof value === "number" && value <= clause.lte;
  if ("lt" in clause) return typeof value === "number" && value < clause.lt;
  if ("gte" in clause) return typeof value === "number" && value >= clause.gte;
  if ("gt" in clause) return typeof value === "number" && value > clause.gt;
  return false;
}

export function evalCondition(
  condition: Condition | undefined,
  answers: Record<string, unknown>
): boolean {
  if (!condition) return true;
  for (const [key, clause] of Object.entries(condition)) {
    if (!clauseMatches(clause, answers[key])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Formula evaluator
// A deliberately tiny expression language: numbers, + - * /, parentheses,
// min() max(), and identifiers that resolve to answer values.
// ---------------------------------------------------------------------------

const MATH_FNS = ["min", "max", "ceil", "floor", "round", "abs", "sqrt", "pow"];

function evalFormula(expr: string, answers: Record<string, unknown>): number {
  // Replace known math helpers with Math.* equivalents, then use Function in a
  // restricted scope. We only trust JSON we ship ourselves.
  let sanitized = expr;
  for (const fn of MATH_FNS) {
    sanitized = sanitized.replace(new RegExp(`\\b${fn}\\s*\\(`, "g"), `Math.${fn}(`);
  }

  const reserved = new Set(["Math", ...MATH_FNS]);
  const ids = Array.from(new Set(sanitized.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) ?? []))
    .filter((id) => !reserved.has(id));

  const args = ids;
  const values = ids.map((id) => {
    const v = answers[id];
    if (typeof v === "number") return v;
    // Coerce booleans to 1/0 so formulas can use both arithmetic (`flag * 10`)
    // and ternary (`flag ? a : b`) against the same answer.
    if (typeof v === "boolean") return v ? 1 : 0;
    // Pass strings through untouched so `categorie == 'musical'` works. Numeric
    // strings still coerce to numbers so `"42" * 2 === 84`.
    if (typeof v === "string") {
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    }
    return 0;
  });

  // eslint-disable-next-line no-new-func
  const fn = new Function(...args, `"use strict"; return (${sanitized});`);
  const result = fn(...values);
  return Number.isFinite(result) ? result : 0;
}

// ---------------------------------------------------------------------------
// Compute evaluation
// ---------------------------------------------------------------------------

function applyModifiers(
  base: number,
  modifiers: Modifier[] | undefined,
  answers: Record<string, unknown>
): number {
  if (!modifiers) return base;
  let result = base;
  for (const m of modifiers) {
    if (!evalCondition(m.when, answers)) continue;
    switch (m.kind) {
      case "multiply":
        result *= m.value;
        break;
      case "add":
        result += m.value;
        break;
      case "min":
        result = Math.max(result, m.value);
        break;
      case "max":
        result = Math.min(result, m.value);
        break;
    }
  }
  return result;
}

export function evalCompute(
  compute: Compute,
  answers: Record<string, unknown>
): number {
  let raw: number;
  switch (compute.kind) {
    case "constant":
      raw = compute.value;
      break;

    case "lookup": {
      raw = compute.fallback ?? 0;
      for (const row of compute.rows) {
        if (evalCondition(row.match, answers)) {
          raw = row.formula ? evalFormula(row.formula, answers) : (row.value ?? 0);
          break;
        }
      }
      break;
    }

    case "percentage": {
      const input = Number(answers[compute.of]);
      const base = Number.isFinite(input) ? input : 0;
      raw = base * compute.rate;
      if (compute.min !== undefined) raw = Math.max(raw, compute.min);
      break;
    }

    case "formula": {
      raw = evalFormula(compute.expr, answers);
      if (compute.min !== undefined) raw = Math.max(raw, compute.min);
      break;
    }

    case "composite": {
      const values = compute.parts.map((p) => evalCompute(p, answers));
      switch (compute.op) {
        case "sum":
          raw = values.reduce((a, b) => a + b, 0);
          break;
        case "max":
          raw = Math.max(...values, 0);
          break;
        case "highestPlusFractionOfLower": {
          const sorted = [...values].sort((a, b) => b - a);
          const [highest, ...rest] = sorted;
          const fraction = compute.fraction ?? 0;
          raw = (highest ?? 0) + rest.reduce((a, b) => a + b * fraction, 0);
          break;
        }
        default:
          raw = 0;
      }
      break;
    }
  }

  // Apply post-modifiers uniformly on every compute kind.
  return applyModifiers(raw, compute.modifiers, answers);
}

// ---------------------------------------------------------------------------
// Visible questions (gated by `when` conditions)
// ---------------------------------------------------------------------------

export function visibleQuestions(
  questions: Question[],
  answers: Record<string, unknown>
): Question[] {
  return questions.filter((q) => evalCondition(q.when, answers));
}

// ---------------------------------------------------------------------------
// Default answers for a fiche
// ---------------------------------------------------------------------------

export function defaultAnswers(fiche: FicheSimulator): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const q of fiche.questions) {
    if (q.default !== undefined) {
      answers[q.id] = q.default;
    } else if (q.type === "radio" || q.type === "select") {
      answers[q.id] = q.options?.[0]?.value;
    } else if (q.type === "number") {
      answers[q.id] = q.min ?? 0;
    } else if (q.type === "boolean") {
      answers[q.id] = false;
    }
  }
  return answers;
}

// ---------------------------------------------------------------------------
// Top-level simulation
// ---------------------------------------------------------------------------

export function simulate(
  fiche: FicheSimulator,
  answers: Record<string, unknown>
): SimulatorResult {
  const sacem = Math.max(0, evalCompute(fiche.compute, answers));

  let spre = 0;
  if (fiche.spre) {
    // skipWhen is an opt-in gate: SPRE is skipped only when the
    // condition is explicitly defined AND matches. An undefined
    // skipWhen means SPRE always applies, not the other way around
    // (evalCondition(undefined) is vacuously true, which would have
    // silently zeroed every SPRE figure).
    const shouldSkip =
      fiche.spre.skipWhen !== undefined &&
      evalCondition(fiche.spre.skipWhen, answers);
    if (!shouldSkip) {
      // Make the SACEM figure available to the SPRE compute tree so
      // formulas like `sacem * 0.65` resolve correctly.
      const spreAnswers = { ...answers, sacem };
      spre = Math.max(0, evalCompute(fiche.spre.compute, spreAnswers));
    }
  }

  const buildScenario = (totalAnnual: number): Scenario => ({
    totalAnnual,
    breakevenMonths:
      totalAnnual > 0 ? Math.ceil((PLAYSAFE_PRICE_HT / totalAnnual) * 12) : Infinity,
    savings: ([5, 10, 15] as const).map((horizon) => ({
      horizon,
      amount: Math.max(0, totalAnnual * horizon - PLAYSAFE_PRICE_HT),
    })),
  });

  return {
    sacem,
    spre,
    withSpre: buildScenario(sacem + spre),
    withoutSpre: buildScenario(sacem),
  };
}
