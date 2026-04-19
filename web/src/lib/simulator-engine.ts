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

function evalFormula(expr: string, answers: Record<string, unknown>): number {
  // Replace min(a,b) / max(a,b) with Math equivalents, then use Function in a
  // restricted scope. We only trust JSON we ship ourselves.
  const sanitized = expr
    .replace(/\bmin\s*\(/g, "Math.min(")
    .replace(/\bmax\s*\(/g, "Math.max(");

  const ids = Array.from(new Set(sanitized.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) ?? []))
    .filter((id) => id !== "Math" && id !== "min" && id !== "max");

  const args = ids;
  const values = ids.map((id) => {
    const v = answers[id];
    if (typeof v === "number") return v;
    if (typeof v === "string" && !Number.isNaN(Number(v))) return Number(v);
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
  switch (compute.kind) {
    case "constant":
      return compute.value;

    case "lookup": {
      for (const row of compute.rows) {
        if (evalCondition(row.match, answers)) {
          if (row.formula) return evalFormula(row.formula, answers);
          return row.value ?? 0;
        }
      }
      return compute.fallback ?? 0;
    }

    case "percentage": {
      const raw = Number(answers[compute.of]);
      const base = Number.isFinite(raw) ? raw : 0;
      let result = base * compute.rate;
      if (compute.min !== undefined) result = Math.max(result, compute.min);
      return result;
    }

    case "formula": {
      let result = evalFormula(compute.expr, answers);
      if (compute.min !== undefined) result = Math.max(result, compute.min);
      return result;
    }

    case "composite": {
      const values = compute.parts.map((p) => evalCompute(p, answers));
      let result: number;
      switch (compute.op) {
        case "sum":
          result = values.reduce((a, b) => a + b, 0);
          break;
        case "max":
          result = Math.max(...values, 0);
          break;
        case "highestPlusFractionOfLower": {
          const sorted = [...values].sort((a, b) => b - a);
          const [highest, ...rest] = sorted;
          const fraction = compute.fraction ?? 0;
          result = (highest ?? 0) + rest.reduce((a, b) => a + b * fraction, 0);
          break;
        }
        default:
          result = 0;
      }
      return applyModifiers(result, compute.modifiers, answers);
    }
  }
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
