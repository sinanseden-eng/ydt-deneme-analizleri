"use strict";

const { getAdminClient, getBucket } = require("./_shared/supabase");

exports.handler = async function handler() {
  const supabase = getAdminClient();
  const bucket = getBucket();
  const staleUploadCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const oldResultCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data: staleJobs, error: staleError } = await supabase.from("analysis_jobs")
      .select("id,file_path,key_path")
      .in("status", ["awaiting_upload", "processing"])
      .lt("updated_at", staleUploadCutoff);
    if (staleError) throw staleError;

    for (const job of staleJobs || []) {
      const paths = [job.file_path, job.key_path].filter(Boolean);
      if (paths.length) {
        const { error } = await supabase.storage.from(bucket).remove(paths);
        if (error) console.warn(`Eski yükleme silinemedi (${job.id}):`, error.message);
      }
    }

    if (staleJobs?.length) {
      const { error } = await supabase.from("analysis_jobs").delete()
        .in("id", staleJobs.map((job) => job.id));
      if (error) throw error;
    }

    const { error: oldResultError } = await supabase.from("analysis_jobs").delete()
      .in("status", ["completed", "completed_with_warnings", "failed"])
      .lt("updated_at", oldResultCutoff);
    if (oldResultError) throw oldResultError;

    return { statusCode: 200, body: JSON.stringify({ staleUploadsRemoved: staleJobs?.length || 0 }) };
  } catch (error) {
    console.error("Zamanlanmış temizlik hatası:", error.message);
    return { statusCode: 500, body: JSON.stringify({ error: "Temizlik tamamlanamadı." }) };
  }
};
