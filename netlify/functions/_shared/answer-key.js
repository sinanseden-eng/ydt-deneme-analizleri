"use strict";

const ExcelJS = require("exceljs");

function acceptPair(map, numberValue, answerValue) {
  const number = Number(numberValue);
  const answer = String(answerValue || "").trim().toUpperCase();
  if (Number.isInteger(number) && number >= 1 && number <= 80 && /^[A-E]$/.test(answer)) {
    map.set(number, answer);
  }
}

function parseCsv(text) {
  const map = new Map();
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const cells = line.split(/[;,\t]/).map((cell) => cell.trim());
    for (let index = 0; index < cells.length - 1; index += 1) {
      acceptPair(map, cells[index], cells[index + 1]);
    }
    const compact = line.match(/(?:^|\s)(80|[1-7]?\d)\s*[-:.)]\s*([A-E])(?:\s|$)/i);
    if (compact) acceptPair(map, compact[1], compact[2]);
  }
  return map;
}

async function parseXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const map = new Map();
  workbook.eachSheet((worksheet) => {
    worksheet.eachRow((row) => {
      const values = row.values.slice(1).map((value) => (
        value && typeof value === "object" && "text" in value ? value.text : value
      ));
      for (let index = 0; index < values.length - 1; index += 1) {
        acceptPair(map, values[index], values[index + 1]);
      }
    });
  });
  return map;
}

async function parseAnswerKeyFile(buffer, fileName) {
  const map = /\.csv$/i.test(fileName)
    ? parseCsv(buffer.toString("utf8"))
    : await parseXlsx(buffer);
  const missing = Array.from({ length: 80 }, (_, index) => index + 1)
    .filter((number) => !map.has(number));
  const warnings = [];
  if (map.size !== 80) warnings.push(`Cevap anahtarında ${map.size}/80 geçerli cevap bulundu.`);
  if (missing.length) warnings.push(`Eksik cevap numaraları: ${missing.join(", ")}`);
  return {
    answers: Object.fromEntries([...map.entries()].sort((a, b) => a[0] - b[0])),
    count: map.size,
    complete: map.size === 80,
    warnings,
  };
}

function formatAnswerKey(answerKey) {
  if (!answerKey?.count) return "Belgede bulunan cevap anahtarını görsel olarak tespit et.";
  return Object.entries(answerKey.answers).map(([number, answer]) => `${number}:${answer}`).join(",");
}

module.exports = { parseCsv, parseAnswerKeyFile, formatAnswerKey };
