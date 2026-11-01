import type { Chunk } from "./knowledge.ts";

const STOPWORDS = new Set(
  "a an and are as at be been by did do does for from had has have he her his how i in is it its me my of on or she shubham shubhams that the their them they this to was were what when where which who why will with worked work you your about tell built build use used using know".split(
    " ",
  ),
);

const K1 = 1.2;
const B = 0.75;
const TITLE_WEIGHT = 3;

function stem(token: string): string {
  if (token.length > 4 && /(ies|ied)$/.test(token))
    return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((token) => !STOPWORDS.has(token))
    .map(stem);
}

/**
 * BM25 over title and text. The corpus is a few dozen short, already-atomic chunks, so
 * lexical scoring finds the right one without an embedding model or a vector database.
 */
export function search(query: string, chunks: Chunk[], limit = 5): Chunk[] {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0 || chunks.length === 0) return [];

  const documents = chunks.map((chunk) => {
    const tokens = [
      ...Array.from({ length: TITLE_WEIGHT }, () =>
        tokenize(chunk.title),
      ).flat(),
      ...tokenize(chunk.text),
    ];
    const frequency = new Map<string, number>();
    for (const token of tokens) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
    return { chunk, frequency, length: tokens.length };
  });

  const averageLength =
    documents.reduce((sum, document) => sum + document.length, 0) /
    documents.length;

  const idf = new Map(
    terms.map((term) => {
      const containing = documents.filter((document) =>
        document.frequency.has(term),
      ).length;
      return [
        term,
        Math.log(
          1 + (documents.length - containing + 0.5) / (containing + 0.5),
        ),
      ];
    }),
  );

  return documents
    .map(({ chunk, frequency, length }) => {
      let score = 0;
      for (const term of terms) {
        const count = frequency.get(term) ?? 0;
        if (count === 0) continue;
        const norm = count + K1 * (1 - B + (B * length) / averageLength);
        score += ((idf.get(term) ?? 0) * (count * (K1 + 1))) / norm;
      }
      return { chunk, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ chunk }) => chunk);
}
