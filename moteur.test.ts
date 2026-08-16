import { describe, expect, it } from "vitest";
import {
  PLAYSAFE_PRICE_HT,
  defaultAnswers,
  evalCondition,
  evalCompute,
  simulate,
  visibleQuestions,
} from "./simulator-engine";
import type { Compute, FicheSimulator, Question } from "./simulator-types";

// ---------------------------------------------------------------------------
// evalCondition
// ---------------------------------------------------------------------------

describe("evalCondition", () => {
  it("returns true for undefined condition (vacuous truth)", () => {
    expect(evalCondition(undefined, {})).toBe(true);
  });

  it("matches scalar shorthand as equality", () => {
    expect(evalCondition({ size: "small" }, { size: "small" })).toBe(true);
    expect(evalCondition({ size: "small" }, { size: "large" })).toBe(false);
  });

  it("supports eq/ne/in/lte/lt/gte/gt clauses", () => {
    expect(evalCondition({ n: { eq: 5 } }, { n: 5 })).toBe(true);
    expect(evalCondition({ n: { ne: 5 } }, { n: 3 })).toBe(true);
    expect(evalCondition({ n: { in: [1, 2, 3] } }, { n: 2 })).toBe(true);
    expect(evalCondition({ n: { in: [1, 2, 3] } }, { n: 4 })).toBe(false);
    expect(evalCondition({ n: { lte: 10 } }, { n: 10 })).toBe(true);
    expect(evalCondition({ n: { lte: 10 } }, { n: 11 })).toBe(false);
    expect(evalCondition({ n: { lt: 10 } }, { n: 10 })).toBe(false);
    expect(evalCondition({ n: { gte: 10 } }, { n: 10 })).toBe(true);
    expect(evalCondition({ n: { gt: 10 } }, { n: 10 })).toBe(false);
  });

  it("requires every clause to match (AND semantics)", () => {
    const cond = { a: 1, b: { gte: 5 } };
    expect(evalCondition(cond, { a: 1, b: 10 })).toBe(true);
    expect(evalCondition(cond, { a: 1, b: 4 })).toBe(false);
    expect(evalCondition(cond, { a: 2, b: 10 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evalCompute, basic kinds
// ---------------------------------------------------------------------------

describe("evalCompute, basic kinds", () => {
  it("returns a constant", () => {
    expect(evalCompute({ kind: "constant", value: 42 }, {})).toBe(42);
  });

  it("looks up the first matching row", () => {
    const compute: Compute = {
      kind: "lookup",
      rows: [
        { match: { n: { lte: 10 } }, value: 100 },
        { match: { n: { lte: 50 } }, value: 500 },
        { match: {}, value: 1000 },
      ],
    };
    expect(evalCompute(compute, { n: 5 })).toBe(100);
    expect(evalCompute(compute, { n: 30 })).toBe(500);
    expect(evalCompute(compute, { n: 999 })).toBe(1000);
  });

  it("evaluates percentage with minimum floor", () => {
    const compute: Compute = {
      kind: "percentage",
      of: "ca",
      rate: 0.05,
      min: 200,
    };
    expect(evalCompute(compute, { ca: 10000 })).toBe(500);
    expect(evalCompute(compute, { ca: 1000 })).toBe(200);
  });

  it("evaluates a formula with answer references", () => {
    const compute: Compute = { kind: "formula", expr: "a * b + 10" };
    expect(evalCompute(compute, { a: 3, b: 4 })).toBe(22);
  });

  it("uses Math helpers in formulas (min/max/ceil/floor/round)", () => {
    expect(evalCompute({ kind: "formula", expr: "min(3, 5)" }, {})).toBe(3);
    expect(evalCompute({ kind: "formula", expr: "max(3, 5)" }, {})).toBe(5);
    expect(evalCompute({ kind: "formula", expr: "ceil(2.1)" }, {})).toBe(3);
    expect(evalCompute({ kind: "formula", expr: "floor(2.9)" }, {})).toBe(2);
    expect(evalCompute({ kind: "formula", expr: "round(2.5)" }, {})).toBe(3);
  });

  it("supports ternary in formulas", () => {
    const compute: Compute = {
      kind: "formula",
      expr: "flag ? 100 : 200",
    };
    expect(evalCompute(compute, { flag: true })).toBe(100);
    expect(evalCompute(compute, { flag: false })).toBe(200);
  });

  it("returns 0 for malformed formula expressions", () => {
    const compute: Compute = { kind: "formula", expr: "a / 0" };
    expect(evalCompute(compute, { a: 5 })).toBe(0);
  });

  it("evaluates composite sum", () => {
    const compute: Compute = {
      kind: "composite",
      op: "sum",
      parts: [
        { kind: "constant", value: 100 },
        { kind: "constant", value: 50 },
      ],
    };
    expect(evalCompute(compute, {})).toBe(150);
  });

  it("evaluates composite max", () => {
    const compute: Compute = {
      kind: "composite",
      op: "max",
      parts: [
        { kind: "constant", value: 100 },
        { kind: "constant", value: 300 },
      ],
    };
    expect(evalCompute(compute, {})).toBe(300);
  });

  it("evaluates highestPlusFractionOfLower", () => {
    const compute: Compute = {
      kind: "composite",
      op: "highestPlusFractionOfLower",
      fraction: 0.5,
      parts: [
        { kind: "constant", value: 100 },
        { kind: "constant", value: 200 },
      ],
    };
    // 200 + 0.5 * 100 = 250
    expect(evalCompute(compute, {})).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// evalCompute, modifiers
// ---------------------------------------------------------------------------

describe("evalCompute, modifiers", () => {
  it("applies multiply modifier conditionally", () => {
    const compute: Compute = {
      kind: "constant",
      value: 100,
      modifiers: [{ kind: "multiply", value: 0.8, when: { tarif_reduit: true } }],
    };
    expect(evalCompute(compute, { tarif_reduit: true })).toBe(80);
    expect(evalCompute(compute, { tarif_reduit: false })).toBe(100);
  });

  it("applies add modifier", () => {
    const compute: Compute = {
      kind: "constant",
      value: 100,
      modifiers: [{ kind: "add", value: 50 }],
    };
    expect(evalCompute(compute, {})).toBe(150);
  });

  it("min modifier enforces a floor", () => {
    const compute: Compute = {
      kind: "constant",
      value: 50,
      modifiers: [{ kind: "min", value: 100 }],
    };
    expect(evalCompute(compute, {})).toBe(100);
  });

  it("max modifier enforces a cap", () => {
    const compute: Compute = {
      kind: "constant",
      value: 500,
      modifiers: [{ kind: "max", value: 300 }],
    };
    expect(evalCompute(compute, {})).toBe(300);
  });

  it("applies modifiers to formula/lookup/composite uniformly", () => {
    const cases: Compute[] = [
      {
        kind: "formula",
        expr: "10 * 10",
        modifiers: [{ kind: "multiply", value: 0.8 }],
      },
      {
        kind: "lookup",
        rows: [{ match: {}, value: 100 }],
        modifiers: [{ kind: "multiply", value: 0.8 }],
      },
      {
        kind: "composite",
        op: "sum",
        parts: [{ kind: "constant", value: 100 }],
        modifiers: [{ kind: "multiply", value: 0.8 }],
      },
    ];
    for (const c of cases) expect(evalCompute(c, {})).toBeCloseTo(80);
  });

  it("applies modifiers in declared order", () => {
    const compute: Compute = {
      kind: "constant",
      value: 100,
      modifiers: [
        { kind: "multiply", value: 2 },
        { kind: "add", value: 10 },
      ],
    };
    expect(evalCompute(compute, {})).toBe(210);
  });
});

// ---------------------------------------------------------------------------
// SPRE behaviour, the regression guard
// ---------------------------------------------------------------------------

describe("simulate, SPRE handling", () => {
  const baseFiche: FicheSimulator = {
    slug: "test",
    activity: "test",
    questions: [],
    compute: { kind: "constant", value: 1000 },
  };

  it("applies SPRE when fiche.spre is defined and no skipWhen", () => {
    const fiche: FicheSimulator = {
      ...baseFiche,
      spre: { compute: { kind: "formula", expr: "sacem * 0.65" } },
    };
    const res = simulate(fiche, {});
    expect(res.sacem).toBe(1000);
    expect(res.spre).toBe(650);
  });

  it("does NOT apply SPRE when fiche.spre is undefined", () => {
    const res = simulate(baseFiche, {});
    expect(res.spre).toBe(0);
  });

  it("skipWhen gates SPRE ONLY when the condition is defined AND matches", () => {
    // Regression: an undefined skipWhen used to vacuously evaluate true,
    // silently zeroing every SPRE figure.
    const fiche: FicheSimulator = {
      ...baseFiche,
      spre: {
        compute: { kind: "formula", expr: "sacem * 0.65" },
        skipWhen: { musique_vivante: true },
      },
    };
    expect(simulate(fiche, { musique_vivante: true }).spre).toBe(0);
    expect(simulate(fiche, { musique_vivante: false }).spre).toBe(650);
  });

  it("honours the SPRE minimum floor", () => {
    const fiche: FicheSimulator = {
      ...baseFiche,
      compute: { kind: "constant", value: 100 },
      spre: { compute: { kind: "formula", expr: "sacem * 0.65", min: 110.6 } },
    };
    const res = simulate(fiche, {});
    expect(res.spre).toBe(110.6);
  });

  it("exposes both scenarios (with and without SPRE)", () => {
    const fiche: FicheSimulator = {
      ...baseFiche,
      spre: { compute: { kind: "formula", expr: "sacem * 0.65" } },
    };
    const res = simulate(fiche, {});
    expect(res.withSpre.totalAnnual).toBe(1650);
    expect(res.withoutSpre.totalAnnual).toBe(1000);
  });

  it("breakeven immédiat (1 mois) dès que le coût annuel dépasse l'abonnement", () => {
    const fiche: FicheSimulator = {
      ...baseFiche,
      compute: { kind: "constant", value: 900 },
    };
    const res = simulate(fiche, {});
    // 900 € / an > 104,64 € d'abonnement annuel → rentabilisé dès le 1er mois
    expect(res.withoutSpre.breakevenMonths).toBe(1);
  });

  it("returns Infinity breakeven when total is zero", () => {
    const fiche: FicheSimulator = {
      ...baseFiche,
      compute: { kind: "constant", value: 0 },
    };
    const res = simulate(fiche, {});
    expect(res.withoutSpre.breakevenMonths).toBe(Infinity);
  });

  it("computes horizon savings correctly at 5/10/15 years", () => {
    const fiche: FicheSimulator = {
      ...baseFiche,
      compute: { kind: "constant", value: 1000 },
    };
    const res = simulate(fiche, {});
    const horizons = res.withoutSpre.savings.map((s) => s.amount);
    // Abonnement : le coût PlaySafe est annuel, donc soustrait à chaque année
    // de l'horizon (et non une seule fois comme l'ancien forfait à vie).
    expect(horizons).toEqual([
      1000 * 5 - PLAYSAFE_PRICE_HT * 5,
      1000 * 10 - PLAYSAFE_PRICE_HT * 10,
      1000 * 15 - PLAYSAFE_PRICE_HT * 15,
    ]);
  });
});

// ---------------------------------------------------------------------------
// defaultAnswers & visibleQuestions
// ---------------------------------------------------------------------------

describe("defaultAnswers", () => {
  it("uses question.default when present", () => {
    const fiche: FicheSimulator = {
      slug: "x",
      activity: "x",
      questions: [{ id: "a", label: "A", type: "number", default: 42 }],
      compute: { kind: "constant", value: 0 },
    };
    expect(defaultAnswers(fiche)).toEqual({ a: 42 });
  });

  it("falls back to first option for radio/select", () => {
    const fiche: FicheSimulator = {
      slug: "x",
      activity: "x",
      questions: [
        {
          id: "a",
          label: "A",
          type: "radio",
          options: [{ value: "foo", label: "foo" }],
        },
      ],
      compute: { kind: "constant", value: 0 },
    };
    expect(defaultAnswers(fiche)).toEqual({ a: "foo" });
  });

  it("falls back to false for boolean without default", () => {
    const fiche: FicheSimulator = {
      slug: "x",
      activity: "x",
      questions: [{ id: "flag", label: "flag", type: "boolean" }],
      compute: { kind: "constant", value: 0 },
    };
    expect(defaultAnswers(fiche)).toEqual({ flag: false });
  });
});

describe("visibleQuestions", () => {
  it("filters out questions whose `when` does not match", () => {
    const questions: Question[] = [
      { id: "a", label: "A", type: "number" },
      {
        id: "b",
        label: "B",
        type: "number",
        when: { a: { gte: 10 } },
      },
    ];
    expect(visibleQuestions(questions, { a: 5 })).toHaveLength(1);
    expect(visibleQuestions(questions, { a: 20 })).toHaveLength(2);
  });
});
