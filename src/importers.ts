import type { AppData, WordEntry, WordSense } from "./types";
import { stableId } from "./types";
import { ensureLearningStates } from "./scheduler";
import { readXlsxTables, type SpreadsheetTable } from "./xlsx-lite";

type Cell = string | number | boolean | null | undefined;
type Row = Cell[];

export interface CoreVocabularyRow {
  headword: string;
  partOfSpeech: string;
  definition: string;
  lapses: number;
  sourceFile: string;
}

export interface SupplementVocabularyRow {
  headword: string;
  definition: string;
  sourceFile: string;
}

export interface ImportStats {
  wordCount: number;
  senseCount: number;
  enrichedWords: number;
  skippedRows: number;
  sourceFiles: string[];
}

export interface ImportPreview {
  words: WordEntry[];
  stats: ImportStats;
}

const normalizeHeadword = (value: Cell) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const cleanText = (value: Cell) => String(value ?? "").trim();
const validHeadword = (value: Cell) => {
  const word = cleanText(value);
  return /^[a-z][a-z' -]*$/i.test(word) && !/^list\d+$/i.test(word);
};

function parseCsv(text: string): Row[] {
  const rows: Row[] = [];
  let row: Row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function parseCoreRows(rows: Row[], sourceFile: string): { rows: CoreVocabularyRow[]; skipped: number } {
  if (!rows.length) return { rows: [], skipped: 0 };
  const headers = rows[0].map((cell) => cleanText(cell).toLowerCase());
  const wordIndex = headers.findIndex((value) => ["单词", "word", "headword"].includes(value));
  const definitionIndex = headers.findIndex((value) => ["释义", "definition", "meaning"].includes(value));
  if (wordIndex < 0 || definitionIndex < 0) return { rows: [], skipped: rows.length };
  const posIndex = headers.findIndex((value) => ["词性", "pos", "part of speech"].includes(value));
  const lapseIndex = headers.findIndex((value) => ["遗忘次数", "lapses", "forget count"].includes(value));
  const parsed: CoreVocabularyRow[] = [];
  let skipped = 0;

  for (const row of rows.slice(1)) {
    if (!validHeadword(row[wordIndex]) || !cleanText(row[definitionIndex])) {
      skipped += 1;
      continue;
    }
    parsed.push({
      headword: cleanText(row[wordIndex]),
      partOfSpeech: posIndex >= 0 ? cleanText(row[posIndex]) : "",
      definition: cleanText(row[definitionIndex]),
      lapses: lapseIndex >= 0 ? Number(row[lapseIndex] ?? 0) || 0 : 0,
      sourceFile,
    });
  }
  return { rows: parsed, skipped };
}

function parseSupplementRows(rows: Row[], sourceFile: string): { rows: SupplementVocabularyRow[]; skipped: number } {
  const parsed: SupplementVocabularyRow[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (!validHeadword(row[0]) || !cleanText(row[1])) {
      skipped += 1;
      continue;
    }
    parsed.push({ headword: cleanText(row[0]), definition: cleanText(row[1]), sourceFile });
  }
  return { rows: parsed, skipped };
}

function parseSenseLine(line: string): { partOfSpeech: string; definition: string } {
  const clean = line.trim().replace(/[；;]+$/, "");
  const matched = clean.match(/^([a-z]{1,5}\.)\s*(.+)$/i);
  if (!matched) return { partOfSpeech: "", definition: clean };
  return { partOfSpeech: matched[1], definition: matched[2].trim() };
}

function senseFrom(word: string, partOfSpeech: string, definition: string, sourceLabel: string): WordSense {
  const key = `${normalizeHeadword(word)}|${partOfSpeech.toLowerCase()}|${definition.replace(/\s+/g, "")}`;
  return {
    id: stableId("sense", key),
    partOfSpeech,
    definitionZh: definition,
    definitionEn: "",
    sourceLabel,
    openSenseId: null,
    usageNote: "",
    contextNote: "",
    examples: [],
    relations: { synonyms: [], antonyms: [], confusables: [] },
    relationState: "unverified",
    relationSource: "No verified lexical-relation evidence in private import",
    relationEvidence: {
      synonyms: { state: "unverified", source: "No verified synonym evidence in private import" },
      antonyms: { state: "unverified", source: "No verified antonym evidence in private import" },
    },
    studyReviewState: "unreviewed",
    studyReviewNote: "",
    enrichmentState: "missing",
    alignmentState: "unverified",
    alignmentScore: 0,
    alignmentSource: "Unverified private import",
  };
}

export function buildImportedWords(
  coreRows: CoreVocabularyRow[],
  supplementRows: SupplementVocabularyRow[],
  now = new Date(),
): { words: WordEntry[]; enrichedWords: number } {
  const supplementMap = new Map<string, SupplementVocabularyRow[]>();
  for (const row of supplementRows) {
    const normalized = normalizeHeadword(row.headword);
    supplementMap.set(normalized, [...(supplementMap.get(normalized) ?? []), row]);
  }
  const coreMap = new Map<string, CoreVocabularyRow[]>();
  for (const row of coreRows) {
    const normalized = normalizeHeadword(row.headword);
    coreMap.set(normalized, [...(coreMap.get(normalized) ?? []), row]);
  }

  const baseRows = coreRows.length ? [...coreMap.entries()] : [...supplementMap.entries()].map(([key, rows]) => [key, [] as CoreVocabularyRow[]] as const);
  let enrichedWords = 0;
  const words: WordEntry[] = [];
  let order = 0;

  for (const [normalized, rows] of baseRows) {
    const firstCore = rows[0];
    const supplemental = supplementMap.get(normalized) ?? [];
    const headword = firstCore?.headword ?? supplemental[0]?.headword ?? normalized;
    const senses: WordSense[] = [];
    const seen = new Set<string>();
    const addSense = (partOfSpeech: string, definition: string, sourceLabel: string) => {
      const normalizedDefinition = definition.replace(/[\s，,。；;（）()]/g, "").toLowerCase();
      if (!normalizedDefinition || seen.has(normalizedDefinition)) return;
      seen.add(normalizedDefinition);
      senses.push(senseFrom(headword, partOfSpeech, definition, sourceLabel));
    };

    for (const core of rows) addSense(core.partOfSpeech, core.definition, core.sourceFile);
    const senseCountBeforeSupplement = senses.length;
    for (const extra of supplemental) {
      for (const rawLine of extra.definition.split(/\n|；/).filter(Boolean)) {
        const parsed = parseSenseLine(rawLine);
        addSense(parsed.partOfSpeech, parsed.definition, extra.sourceFile);
      }
    }
    if (senses.length > senseCountBeforeSupplement && firstCore) enrichedWords += 1;
    if (!senses.length) continue;

    const sourceFiles = [...new Set([...rows.map((row) => row.sourceFile), ...supplemental.map((row) => row.sourceFile)])];
    words.push({
      id: stableId("word", normalized),
      headword,
      normalizedHeadword: normalized,
      pronunciations: [],
      audioSources: [],
      senses,
      sourceFiles,
      initialLapses: Math.max(0, ...rows.map((row) => row.lapses)),
      sourceConsensus: supplemental.length > 0,
      frequencyProfile: {
        tier: "unranked",
        rank: 0,
        priorityScore: 0,
        localMaterialCount: 0,
        officialMaterialCount: 0,
        evidenceBySource: {},
      },
      order,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    order += 1;
  }
  return { words, enrichedWords };
}

async function tablesFromFile(file: File): Promise<SpreadsheetTable[]> {
  if (file.name.toLowerCase().endsWith(".csv")) {
    return [{ name: "CSV", rows: parseCsv(await file.text()) }];
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("当前支持 XLSX 和 CSV；请先把旧版 XLS 另存为 XLSX。");
  return readXlsxTables(await file.arrayBuffer());
}

export async function previewVocabularyImport(files: File[]): Promise<ImportPreview> {
  const coreRows: CoreVocabularyRow[] = [];
  const supplementRows: SupplementVocabularyRow[] = [];
  let skippedRows = 0;

  for (const file of files) {
    const tables = await tablesFromFile(file);
    const coreTable = tables.find((table) => table.name.trim() === "词表");
    if (coreTable) {
      const parsed = parseCoreRows(coreTable.rows, file.name);
      coreRows.push(...parsed.rows);
      skippedRows += parsed.skipped;
      continue;
    }

    const rows = tables[0].rows;
    const coreParsed = parseCoreRows(rows, file.name);
    if (coreParsed.rows.length) {
      coreRows.push(...coreParsed.rows);
      skippedRows += coreParsed.skipped;
    } else {
      const supplementParsed = parseSupplementRows(rows, file.name);
      supplementRows.push(...supplementParsed.rows);
      skippedRows += supplementParsed.skipped;
    }
  }

  const built = buildImportedWords(coreRows, supplementRows);
  if (!built.words.length) throw new Error("没有识别到有效词条。请使用包含“单词/释义”列的 XLSX 或 CSV。 ");
  return {
    words: built.words,
    stats: {
      wordCount: built.words.length,
      senseCount: built.words.reduce((sum, word) => sum + word.senses.length, 0),
      enrichedWords: built.enrichedWords,
      skippedRows,
      sourceFiles: files.map((file) => file.name),
    },
  };
}

export function mergeImport(data: AppData, preview: ImportPreview): AppData {
  const existing = new Map(data.words.map((word) => [word.normalizedHeadword, word]));
  for (const incoming of preview.words) {
    const current = existing.get(incoming.normalizedHeadword);
    if (!current) {
      existing.set(incoming.normalizedHeadword, incoming);
      continue;
    }
    const senses = new Map(current.senses.map((sense) => [sense.id, sense]));
    for (const sense of incoming.senses) senses.set(sense.id, senses.get(sense.id) ?? sense);
    existing.set(incoming.normalizedHeadword, {
      ...current,
      senses: [...senses.values()],
      sourceFiles: [...new Set([...current.sourceFiles, ...incoming.sourceFiles])],
      initialLapses: Math.max(current.initialLapses, incoming.initialLapses),
      updatedAt: new Date().toISOString(),
    });
  }
  const words = [...existing.values()].sort((a, b) => a.order - b.order || a.headword.localeCompare(b.headword));
  return {
    ...data,
    words,
    learning: ensureLearningStates(words, data.learning),
    importedAt: new Date().toISOString(),
    sourceFiles: [...new Set([...data.sourceFiles, ...preview.stats.sourceFiles])],
  };
}
