"use strict";

const {
  deleteKeys, getJob, jobObjectKey, listObjects, lockObjectKey,
} = require("./_shared/r2");

exports.handler = async function handler() {
  const staleUploadCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const oldResultCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let staleUploadsRemoved = 0;
  let oldJobsRemoved = 0;

  try {
    const uploads = await listObjects("uploads/");
    const staleUploadKeys = uploads
      .filter((object) => new Date(object.LastModified || 0).getTime() < staleUploadCutoff)
      .map((object) => object.Key);
    await deleteKeys(staleUploadKeys);
    staleUploadsRemoved = staleUploadKeys.length;

    const jobObjects = await listObjects("jobs/");
    for (const object of jobObjects) {
      const match = String(object.Key || "").match(/^jobs\/([0-9a-f-]{36})\.json$/i);
      if (!match) continue;
      const jobId = match[1];
      try {
        const record = await getJob(jobId);
        if (!record) continue;
        const job = record.job;
        const updatedAt = new Date(job.updated_at || job.created_at || 0).getTime();
        const isStaleActive = ["awaiting_upload", "processing"].includes(job.status)
          && updatedAt < staleUploadCutoff;
        const isOldResult = ["completed", "completed_with_warnings", "failed"].includes(job.status)
          && updatedAt < oldResultCutoff;
        if (!isStaleActive && !isOldResult) continue;
        await deleteKeys([
          job.file_path,
          job.key_path,
          jobObjectKey(jobId),
          lockObjectKey(jobId),
        ]);
        oldJobsRemoved += 1;
      } catch (error) {
        console.warn(`R2 iş kaydı temizlenemedi (${jobId}):`, error.message);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ staleUploadsRemoved, oldJobsRemoved }),
    };
  } catch (error) {
    console.error("Zamanlanmış temizlik hatası:", error.message);
    return { statusCode: 500, body: JSON.stringify({ error: "Temizlik tamamlanamadı." }) };
  }
};
