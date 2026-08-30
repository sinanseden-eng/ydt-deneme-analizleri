"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const { parseCsv, parseAnswerKeyFile } = require("../netlify/functions/_shared/answer-key");

test("CSV keys accept semicolon, comma and compact rows", () => {
  const map = parseCsv("1;B\n2,C\n3: D\n");
  assert.deepEqual(Object.fromEntries(map), { 1: "B", 2: "C", 3: "D" });
});

test("XLSX keys validate all 80 numbered answers", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Anahtar");
  for (let number = 1; number <= 80; number += 1) sheet.addRow([number, "A"]);
  const buffer = await workbook.xlsx.writeBuffer();
  const result = await parseAnswerKeyFile(Buffer.from(buffer), "answer-key.xlsx");
  assert.equal(result.count, 80);
  assert.equal(result.complete, true);
  assert.deepEqual(result.warnings, []);
});
