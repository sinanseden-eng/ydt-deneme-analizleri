"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  difficultyLabel,
  auditQuestionCoverage,
  normalizeCefr,
  normalizeAnalysis,
} = require("../netlify/functions/_shared/scoring");

test("difficulty thresholds match the calibrated four-band scale", () => {
  assert.equal(difficultyLabel(54), "Kolay");
  assert.equal(difficultyLabel(55), "Orta");
  assert.equal(difficultyLabel(61), "Orta-zor");
  assert.equal(difficultyLabel(68), "Zor");
});

test("overall index uses the fixed educational weights", () => {
  const result = normalizeAnalysis({
    scores: {
      vocabulary: 60,
      grammar: 50,
      reading: 70,
      questionSkills: 60,
      distractors: 65,
      timePressure: 50,
    },
    questionAudit: Array.from({ length: 80 }, (_, index) => ({ number: index + 1, answer: "A" })),
    confidence: 88,
  });
  assert.equal(result.difficultyIndex, 62);
  assert.equal(result.difficultyLabel, "Orta-zor");
  assert.equal(result.coverage.complete, true);
  assert.equal(result.closestReference.year, 2024);
});

test("question coverage is derived from unique 1-80 audit records", () => {
  const audit = Array.from({ length: 80 }, (_, index) => ({ number: index + 1, answer: "A" }));
  audit.push({ number: 80, answer: "A" });
  audit.splice(41, 1);
  const result = auditQuestionCoverage({ questionAudit: audit });
  assert.equal(result.detectedQuestions, 79);
  assert.equal(result.complete, false);
  assert.match(result.warnings.join(" "), /42/);
  assert.match(result.warnings.join(" "), /80/);
});

test("external keys are compared without storing the answer list", () => {
  const questionAudit = Array.from({ length: 80 }, (_, index) => ({ number: index + 1, answer: "B" }));
  questionAudit[9].answer = "C";
  const answers = Object.fromEntries(Array.from({ length: 80 }, (_, index) => [index + 1, "B"]));
  const result = auditQuestionCoverage({ questionAudit }, { answers });
  assert.equal(result.comparedAnswers, 80);
  assert.equal(result.matchingAnswers, 79);
  assert.equal(result.mismatchedAnswers, 1);
  assert.equal(result.verified, false);
});

test("CEFR shares are normalized to exactly 100 percent", () => {
  const profile = normalizeCefr({ b1: 10, b2: 25, c1: 50, c2: 5 });
  assert.equal(Object.values(profile).reduce((sum, value) => sum + value, 0), 100);
});
