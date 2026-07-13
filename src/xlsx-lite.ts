export type SpreadsheetCell = string | number | boolean | null | undefined;

export interface SpreadsheetTable {
  name: string;
  rows: SpreadsheetCell[][];
}

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const MAX_CELLS_PER_SHEET = 250_000;
const textDecoder = new TextDecoder("utf-8");

interface ZipEntry {
  name: string;
  flags: number;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function uint16(view: DataView, offset: number) {
  if (offset < 0 || offset + 2 > view.byteLength) throw new Error("XLSX 文件结构不完整。");
  return view.getUint16(offset, true);
}

function uint32(view: DataView, offset: number) {
  if (offset < 0 || offset + 4 > view.byteLength) throw new Error("XLSX 文件结构不完整。");
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(view: DataView) {
  const minimum = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (uint32(view, offset) === 0x06054b50) return offset;
  }
  throw new Error("这不是有效的 XLSX 文件，或文件已经损坏。");
}

function parseZipEntries(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error("XLSX 文件超过 50 MB，已停止读取。");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(view);
  const entryCount = uint16(view, endOffset + 10);
  let cursor = uint32(view, endOffset + 16);
  if (entryCount > MAX_ENTRIES) throw new Error("XLSX 内部文件数量异常，已停止读取。");

  const entries = new Map<string, ZipEntry>();
  for (let index = 0; index < entryCount; index += 1) {
    if (uint32(view, cursor) !== 0x02014b50) throw new Error("XLSX 目录结构不完整。");
    const flags = uint16(view, cursor + 8);
    const compression = uint16(view, cursor + 10);
    const compressedSize = uint32(view, cursor + 20);
    const uncompressedSize = uint32(view, cursor + 24);
    const nameLength = uint16(view, cursor + 28);
    const extraLength = uint16(view, cursor + 30);
    const commentLength = uint16(view, cursor + 32);
    const localOffset = uint32(view, cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.byteLength) throw new Error("XLSX 文件名结构不完整。");
    const name = textDecoder.decode(bytes.subarray(nameStart, nameEnd)).replace(/^\/+/, "");
    if (name.includes("../") || name.startsWith("..")) throw new Error("XLSX 包含不安全的文件路径。");
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error("XLSX 内部单个文件过大，已停止读取。");
    entries.set(name, { name, flags, compression, compressedSize, uncompressedSize, localOffset });
    cursor = nameEnd + extraLength + commentLength;
  }
  return { entries, bytes, view };
}

async function inflateRaw(data: Uint8Array) {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntry(
  archive: ReturnType<typeof parseZipEntries>,
  name: string,
): Promise<Uint8Array | null> {
  const entry = archive.entries.get(name);
  if (!entry) return null;
  if (entry.flags & 0x1) throw new Error("暂不支持加密的 XLSX 文件。");
  const { view, bytes } = archive;
  if (uint32(view, entry.localOffset) !== 0x04034b50) throw new Error("XLSX 数据结构不完整。");
  const nameLength = uint16(view, entry.localOffset + 26);
  const extraLength = uint16(view, entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataStart < 0 || dataEnd > bytes.byteLength) throw new Error("XLSX 数据范围无效。");
  const compressed = bytes.slice(dataStart, dataEnd);
  const result = entry.compression === 0 ? compressed : entry.compression === 8 ? await inflateRaw(compressed) : null;
  if (!result) throw new Error(`XLSX 使用了暂不支持的压缩方式（${entry.compression}）。`);
  if (result.byteLength > MAX_ENTRY_BYTES || (entry.uncompressedSize && result.byteLength !== entry.uncompressedSize)) {
    throw new Error("XLSX 解压后的数据大小异常。");
  }
  return result;
}

function decodeXml(value: string) {
  return value.replace(/&#x([0-9a-f]+);|&#(\d+);|&(?:amp|lt|gt|quot|apos);/gi, (entity, hex, decimal) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
    return ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" } as Record<string, string>)[
      entity.toLowerCase()
    ];
  });
}

function attribute(tag: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return decodeXml(match?.[1] ?? match?.[2] ?? "");
}

function xmlTextFragments(xml: string) {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map((match) => decodeXml(match[1])).join("");
}

function parseSharedStrings(xml: string) {
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si(?:\s[^>]*)?\/>/gi)].map((match) =>
    match[1] ? xmlTextFragments(match[1]) : "",
  );
}

function columnIndex(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0].toUpperCase();
  if (!letters) return -1;
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result - 1;
}

function parseWorksheet(xml: string, sharedStrings: string[]) {
  const rows: SpreadsheetCell[][] = [];
  let cellCount = 0;
  for (const match of xml.matchAll(/<c(\s[^>]*)?\/>|<c(\s[^>]*)?>([\s\S]*?)<\/c>/gi)) {
    cellCount += 1;
    if (cellCount > MAX_CELLS_PER_SHEET) throw new Error("单个工作表超过 25 万个单元格，已停止读取。");
    const attributes = match[1] ?? match[2] ?? "";
    const body = match[3] ?? "";
    const reference = attribute(attributes, "r");
    const column = columnIndex(reference);
    const rowNumber = Number(reference.match(/(\d+)$/)?.[1]);
    if (column < 0 || !Number.isInteger(rowNumber) || rowNumber < 1) continue;
    const type = attribute(attributes, "t");
    const raw = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i)?.[1] ?? "";
    let value: SpreadsheetCell = "";
    if (type === "s") value = sharedStrings[Number(raw)] ?? "";
    else if (type === "inlineStr") value = xmlTextFragments(body);
    else if (type === "b") value = raw === "1";
    else if (type === "str") value = decodeXml(raw);
    else if (raw !== "") value = Number.isFinite(Number(raw)) ? Number(raw) : decodeXml(raw);
    const row = (rows[rowNumber - 1] ??= []);
    row[column] = value;
  }
  return rows.map((row) => row ?? []);
}

function normalizeTarget(target: string) {
  const pieces: string[] = [];
  for (const piece of target.replace(/^\/+/, "").split("/")) {
    if (!piece || piece === ".") continue;
    if (piece === "..") pieces.pop();
    else pieces.push(piece);
  }
  return pieces[0] === "xl" ? pieces.join("/") : `xl/${pieces.join("/")}`;
}

export async function readXlsxTables(buffer: ArrayBuffer): Promise<SpreadsheetTable[]> {
  const archive = parseZipEntries(new Uint8Array(buffer));
  const workbookBytes = await readZipEntry(archive, "xl/workbook.xml");
  const relationshipsBytes = await readZipEntry(archive, "xl/_rels/workbook.xml.rels");
  if (!workbookBytes || !relationshipsBytes) throw new Error("XLSX 缺少工作簿信息。");
  const workbookXml = textDecoder.decode(workbookBytes);
  const relationshipsXml = textDecoder.decode(relationshipsBytes);
  const relationships = new Map<string, string>();
  for (const match of relationshipsXml.matchAll(/<Relationship\b([^>]*)\/?\s*>/gi)) {
    const id = attribute(match[1], "Id");
    const target = attribute(match[1], "Target");
    if (id && target && !attribute(match[1], "TargetMode")) relationships.set(id, normalizeTarget(target));
  }
  const sharedStringBytes = await readZipEntry(archive, "xl/sharedStrings.xml");
  const sharedStrings = sharedStringBytes ? parseSharedStrings(textDecoder.decode(sharedStringBytes)) : [];
  const tables: SpreadsheetTable[] = [];
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/?\s*>/gi)) {
    const name = attribute(match[1], "name");
    const relationshipId = attribute(match[1], "r:id");
    const path = relationships.get(relationshipId);
    if (!name || !path || !path.startsWith("xl/worksheets/")) continue;
    const sheetBytes = await readZipEntry(archive, path);
    if (sheetBytes) tables.push({ name, rows: parseWorksheet(textDecoder.decode(sheetBytes), sharedStrings) });
  }
  if (!tables.length) throw new Error("XLSX 中没有可读取的工作表。");
  return tables;
}
