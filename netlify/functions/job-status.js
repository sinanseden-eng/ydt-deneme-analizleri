"use strict";

const { json, parseJsonBody, methodNotAllowed } = require("./_shared/http");
const {
  deleteKeys, getJob, lockObjectKey, saveJob, verifyClientToken,
} = require("./_shared/r2");
const { validateJobCredentials } = require("./_shared/validation");

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") return methodNotAllowed();
  try {
    const body = parseJsonBody(event);
    const { jobId, clientToken } = validateJobCredentials(body.jobId, body.clientToken);
    const record = await getJob(jobId);
    if (!record || !verifyClientToken(record.job, clientToken)) {
      return json(404, { error: "Analiz kaydı bulunamadı." });
    }
    let job = record.job;
    const processingAge = Date.now() - new Date(job.updated_at || job.created_at || 0).getTime();
    if (job.status === "processing" && processingAge > 20 * 60 * 1000) {
      job = await saveJob({
        ...job,
        status: "failed",
        error_message: "Analiz zaman sınırını aştı. Lütfen yeni bir analiz başlatın.",
      });
      await deleteKeys([job.file_path, job.key_path, lockObjectKey(job.id)]);
    }
    return json(200, {
      id: job.id,
      status: job.status,
      progress: job.progress,
      exam_name: job.exam_name,
      result: job.result,
      error_message: job.error_message,
      created_at: job.created_at,
      completed_at: job.completed_at,
    });
  } catch (error) {
    console.error("Durum sorgulama hatası:", error.message);
    return json(error.statusCode || 500, { error: error.safe ? error.message : "Analiz durumu okunamadı." });
  }
};
