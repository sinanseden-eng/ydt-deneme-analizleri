"use strict";

const { json, parseJsonBody, methodNotAllowed } = require("./_shared/http");
const {
  acquireJobLock,
  deleteKeys,
  getJob,
  getObjectBuffer,
  headObject,
  lockObjectKey,
  releaseJobLock,
  saveJob,
  verifyClientToken,
} = require("./_shared/r2");
const { validateJobCredentials } = require("./_shared/validation");
const { parseAnswerKeyFile } = require("./_shared/answer-key");
const { uploadPdf, deleteGeminiFile, generateAnalysis } = require("./_shared/gemini");
const { auditQuestionCoverage, normalizeAnalysis } = require("./_shared/scoring");

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") return methodNotAllowed();
  let job;
  let activeJobId;
  let geminiFile;
  let lockAcquired = false;
  let shouldCleanupUploads = false;
  try {
    const body = parseJsonBody(event);
    const { jobId, clientToken } = validateJobCredentials(body.jobId, body.clientToken);
    activeJobId = jobId;
    const initialRecord = await getJob(jobId);
    if (!initialRecord || !verifyClientToken(initialRecord.job, clientToken)) {
      return json(404, { error: "Analiz kaydı bulunamadı." });
    }
    if (initialRecord.job.status !== "awaiting_upload") {
      return json(202, { accepted: true, status: initialRecord.job.status });
    }

    lockAcquired = await acquireJobLock(jobId);
    if (!lockAcquired) return json(202, { accepted: true, status: "processing" });

    const claimedRecord = await getJob(jobId);
    if (!claimedRecord || !verifyClientToken(claimedRecord.job, clientToken)) {
      return json(404, { error: "Analiz kaydı bulunamadı." });
    }
    job = claimedRecord.job;
    if (job.status !== "awaiting_upload") {
      return json(202, { accepted: true, status: job.status });
    }
    shouldCleanupUploads = true;

    const pdfHead = await headObject(job.file_path);
    if (Number(pdfHead.ContentLength) !== Number(job.file_size)) {
      throw new Error("Yüklenen PDF boyutu beklenen değerle uyuşmuyor.");
    }
    if (job.key_path) {
      const keyHead = await headObject(job.key_path);
      if (Number(keyHead.ContentLength) !== Number(job.key_size)) {
        throw new Error("Cevap anahtarı boyutu beklenen değerle uyuşmuyor.");
      }
    }

    job = await saveJob({ ...job, status: "processing", progress: 8, error_message: null });
    const pdfBuffer = await getObjectBuffer(job.file_path);
    if (pdfBuffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("Yüklenen dosya geçerli bir PDF değil.");
    }

    let answerKey = null;
    if (job.key_path) {
      answerKey = await parseAnswerKeyFile(await getObjectBuffer(job.key_path), job.key_path);
    }

    job = await saveJob({ ...job, progress: 24 });
    geminiFile = await uploadPdf(pdfBuffer, job.original_filename);
    job = await saveJob({ ...job, progress: 42 });

    let raw = await generateAnalysis(geminiFile, answerKey, false);
    const firstAudit = auditQuestionCoverage(raw, answerKey);
    if (!firstAudit.verified) {
      job = await saveJob({ ...job, progress: 68 });
      const retry = await generateAnalysis(geminiFile, answerKey, true);
      const retryAudit = auditQuestionCoverage(retry, answerKey);
      const firstQuality = (firstAudit.verified ? 10000 : 0)
        + firstAudit.detectedQuestions * 100
        + firstAudit.detectedAnswers
        - firstAudit.mismatchedAnswers;
      const retryQuality = (retryAudit.verified ? 10000 : 0)
        + retryAudit.detectedQuestions * 100
        + retryAudit.detectedAnswers
        - retryAudit.mismatchedAnswers;
      if (retryQuality > firstQuality) raw = retry;
    }

    job = await saveJob({ ...job, progress: 88 });
    const result = normalizeAnalysis(raw, answerKey);
    if (!result.isValid) {
      throw new Error(raw.errorMessage || "Belge geçerli bir YDT denemesi olarak doğrulanamadı.");
    }
    if (answerKey?.warnings?.length) {
      result.warnings = [...result.warnings, ...answerKey.warnings].slice(0, 10);
    }
    if (answerKey) {
      result.answerKey = {
        detected: answerKey.count,
        complete: answerKey.complete
          && result.coverage.comparedAnswers === 80
          && result.coverage.mismatchedAnswers === 0,
        source: "uploaded",
        compared: result.coverage.comparedAnswers,
        matched: result.coverage.matchingAnswers,
      };
    } else {
      result.answerKey = {
        detected: result.coverage.detectedAnswers,
        complete: result.coverage.detectedAnswers === 80,
        source: "pdf",
      };
    }
    const hasWarnings = !result.coverage.complete || !result.answerKey.complete || result.warnings.length > 0;
    const completedAt = new Date().toISOString();
    job = await saveJob({
      ...job,
      status: hasWarnings ? "completed_with_warnings" : "completed",
      progress: 100,
      result,
      completed_at: completedAt,
    });
    return json(200, { completed: true });
  } catch (error) {
    console.error("Arka plan analiz hatası:", error);
    if (job?.id) {
      try {
        job = await saveJob({
          ...job,
          status: "failed",
          error_message: "Belge analiz edilemedi. Lütfen dosyayı ve servis ayarlarını kontrol edin.",
        });
      } catch (saveError) {
        console.error("Başarısız iş durumu kaydedilemedi:", saveError.message);
      }
    }
    return json(500, { error: "Analiz tamamlanamadı." });
  } finally {
    await deleteGeminiFile(geminiFile);
    if (shouldCleanupUploads && job?.file_path) {
      try { await deleteKeys([job.file_path, job.key_path]); } catch (error) {
        console.warn("Geçici R2 dosyaları silinemedi:", error.message);
      }
    }
    if (lockAcquired && activeJobId) {
      try { await releaseJobLock(activeJobId); } catch (error) {
        console.warn(`İş kilidi silinemedi (${lockObjectKey(activeJobId)}):`, error.message);
      }
    }
  }
};
