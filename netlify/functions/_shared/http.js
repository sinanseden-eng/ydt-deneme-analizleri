"use strict";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(statusCode, value) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(value),
  };
}

function parseJsonBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    const error = new Error("Geçersiz istek gövdesi.");
    error.statusCode = 400;
    throw error;
  }
}

function methodNotAllowed() {
  return json(405, { error: "Bu işlem için POST isteği gereklidir." });
}

module.exports = { json, parseJsonBody, methodNotAllowed };
