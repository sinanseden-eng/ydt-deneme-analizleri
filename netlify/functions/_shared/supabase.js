"use strict";

const { createClient } = require("@supabase/supabase-js");

let cachedClient;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Eksik sunucu ayarı: ${name}`);
  return value;
}

function getAdminClient() {
  if (!cachedClient) {
    cachedClient = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return cachedClient;
}

function getPublicConfig() {
  const url = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  return {
    url,
    storageUrl: url.replace(".supabase.co", ".storage.supabase.co"),
    anonKey: requireEnv("SUPABASE_ANON_KEY"),
    bucket: process.env.SUPABASE_STORAGE_BUCKET || "ydt-uploads",
  };
}

function getBucket() {
  return process.env.SUPABASE_STORAGE_BUCKET || "ydt-uploads";
}

module.exports = { getAdminClient, getPublicConfig, getBucket, requireEnv };
