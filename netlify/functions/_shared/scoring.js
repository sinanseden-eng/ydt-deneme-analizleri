"use strict";

const WEIGHTS = Object.freeze({
  vocabulary: 0.20,
  grammar: 0.15,
  reading: 0.25,
  questionSkills: 0.15,
  distractors: 0.20,
  timePressure: 0.05,
});

const REFERENCES = Object.freeze([
  { year: 2022, score: 55, label: "Orta" },
  { year: 2023, score: 57, label: "Orta" },
  { year: 2024, score: 61, label: "Orta-zor" },
  { year: 2025, score: 69, label: "Zor" },
  { year: 2026, score: 58, label: "Orta" },
]);

function clamp(value, min = 0, max = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
}

function cleanResultText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

function normalizeCefr(source = {}) {
  const values = ["b1", "b2", "c1", "c2"].map((key) => clamp(source[key]));
  const sum = values.reduce((total, value) => total + value, 0);
  if (!sum) return { b1: 0, b2: 0, c1: 0, c2: 0 };
  const normalized = values.map((value) => Math.round((value / sum) * 100));
  normalized[normalized.indexOf(Math.max(...normalized))] += 100 - normalized.reduce((total, value) => total + value, 0);
  return Object.fromEntries(["b1", "b2", "c1", "c2"].map((key, index) => [key, normalized[index]]));
}

function difficultyLabel(score) {
  if (score < 55) return "Kolay";
  if (score < 61) return "Orta";
  if (score < 68) return "Orta-zor";
  return "Zor";
}

function closestReference(score) {
  return REFERENCES.reduce((closest, reference) => (
    Math.abs(reference.score - score) < Math.abs(closest.score - score) ? reference : closest
  ), REFERENCES[0]);
}

function auditQuestionCoverage(raw = {}, answerKey = null) {
  const seen = new Map();
  const duplicates = new Set();
  for (const item of Array.isArray(raw.questionAudit) ? raw.questionAudit : []) {
    const number = Number(item?.number);
    if (!Number.isInteger(number) || number < 1 || number > 80) continue;
    if (seen.has(number)) duplicates.add(number);
    if (!seen.has(number)) {
      const answer = String(item?.answer || "").trim().toUpperCase();
      seen.set(number, /^[A-E]$/.test(answer) ? answer : null);
    }
  }
  const missing = Array.from({ length: 80 }, (_, index) => index + 1)
    .filter((number) => !seen.has(number));
  const detectedAnswers = [...seen.values()].filter(Boolean).length;
  const expected = answerKey?.answers || null;
  let comparedAnswers = 0;
  let matchingAnswers = 0;
  const mismatches = [];
  if (expected) {
    for (const [number, answer] of seen.entries()) {
      const expectedAnswer = expected[number];
      if (!answer || !expectedAnswer) continue;
      comparedAnswers += 1;
      if (answer === expectedAnswer) matchingAnswers += 1;
      else mismatches.push(number);
    }
  }
  const warnings = [];
  if (duplicates.size) warnings.push(`Yinelenen soru numaraları: ${[...duplicates].sort((a, b) => a - b).join(", ")}`);
  if (missing.length) warnings.push(`Görsel denetimde bulunamayan soru numaraları: ${missing.join(", ")}`);
  if (mismatches.length) warnings.push(`Harici anahtarla uyuşmayan ${mismatches.length} cevap eşleşmesi bulundu.`);
  return {
    detectedQuestions: seen.size,
    detectedAnswers,
    complete: seen.size === 80 && duplicates.size === 0,
    verified: seen.size === 80
      && duplicates.size === 0
      && detectedAnswers === 80
      && (!expected || (comparedAnswers === 80 && mismatches.length === 0)),
    comparedAnswers,
    matchingAnswers,
    mismatchedAnswers: mismatches.length,
    warnings,
  };
}

function normalizeAnalysis(raw = {}, answerKey = null) {
  const sourceScores = raw.scores || {};
  const scores = Object.fromEntries(
    Object.keys(WEIGHTS).map((key) => [key, Math.round(clamp(sourceScores[key]))]),
  );
  const difficultyIndex = Math.round(Object.entries(WEIGHTS)
    .reduce((sum, [key, weight]) => sum + scores[key] * weight, 0));
  const reference = closestReference(difficultyIndex);
  const audit = auditQuestionCoverage(raw, answerKey);
  const detectedQuestions = audit.detectedQuestions;
  const detectedAnswers = audit.detectedAnswers;
  const coveragePercent = Math.round((detectedQuestions / 80) * 100);

  return {
    isValid: raw.isValid !== false,
    errorMessage: raw.errorMessage || "",
    difficultyIndex,
    difficultyLabel: difficultyLabel(difficultyIndex),
    closestReference: {
      year: reference.year,
      score: reference.score,
      comparison: cleanResultText(raw.closestReferenceComment, 300)
        || `${reference.year} ÖSYM YDT düzeyine en yakın sonuç.`,
    },
    confidence: Math.round(clamp(raw.confidence)),
    scores,
    coverage: {
      detectedQuestions,
      detectedAnswers,
      percentage: coveragePercent,
      complete: audit.complete,
      comparedAnswers: audit.comparedAnswers,
      matchingAnswers: audit.matchingAnswers,
      mismatchedAnswers: audit.mismatchedAnswers,
    },
    cefrProfile: normalizeCefr(raw.cefrProfile),
    sectionAnalysis: (Array.isArray(raw.sectionAnalysis) ? raw.sectionAnalysis : []).slice(0, 12).map((section) => ({
      name: cleanResultText(section?.name, 80),
      questionRange: cleanResultText(section?.questionRange, 40),
      score: Math.round(clamp(section?.score)),
      rationale: cleanResultText(section?.rationale, 320),
    })),
    hardestQuestionTypes: (Array.isArray(raw.hardestQuestionTypes) ? raw.hardestQuestionTypes : []).slice(0, 6).map((item) => ({
      type: cleanResultText(item?.type, 80),
      score: Math.round(clamp(item?.score)),
      reason: cleanResultText(item?.reason, 240),
    })),
    strengths: (Array.isArray(raw.strengths) ? raw.strengths : [])
      .slice(0, 5).map((item) => cleanResultText(item, 180)).filter(Boolean),
    warnings: [
      ...(Array.isArray(raw.warnings) ? raw.warnings : []),
      ...audit.warnings,
    ].slice(0, 10).map((item) => cleanResultText(item, 240)).filter(Boolean),
    educationalComment: cleanResultText(raw.educationalComment, 600) || "Analiz tamamlandı.",
    methodology: {
      basis: "2022-2026 ÖSYM YDT kalibrasyonu",
      weights: WEIGHTS,
      references: REFERENCES,
      type: "predicted_difficulty",
    },
  };
}

module.exports = {
  WEIGHTS,
  REFERENCES,
  clamp,
  cleanResultText,
  normalizeCefr,
  difficultyLabel,
  closestReference,
  auditQuestionCoverage,
  normalizeAnalysis,
};
