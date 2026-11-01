import type { Post } from "../types.ts";
import { toLinkedInPost } from "./normalize.ts";

/** Handles quoted fields with commas and newlines, which every long post has. */
export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Reads Shares.csv from LinkedIn's "Get a copy of your data" export. Posts limited to
 * connections are left out, because this site is public.
 */
export function parseSharesCsv(csv: string): Post[] {
  const [header, ...rows] = parseCsv(csv.replace(/^﻿/, ""));
  if (!header) throw new Error("Shares.csv is empty");

  const columns = header.map((name) => name.trim().toLowerCase());
  const dateColumn = columns.indexOf("date");
  const linkColumn = columns.indexOf("sharelink");
  const textColumn = columns.indexOf("sharecommentary");
  const visibilityColumn = columns.indexOf("visibility");
  if (dateColumn < 0 || linkColumn < 0 || textColumn < 0) {
    throw new Error(
      `Shares.csv is missing expected columns (date, sharelink, sharecommentary). Found: ${columns.join(", ")}`,
    );
  }

  return rows.flatMap((row) => {
    const visibility =
      visibilityColumn >= 0 ? (row[visibilityColumn] ?? "") : "";
    if (/connections/i.test(visibility)) return [];
    const post = toLinkedInPost({
      text: row[textColumn] ?? "",
      url: row[linkColumn] ?? "",
      // The export writes "2025-03-14 09:21:05" in UTC.
      publishedAt: `${(row[dateColumn] ?? "").trim().replace(" ", "T")}Z`,
    });
    return post ? [post] : [];
  });
}
