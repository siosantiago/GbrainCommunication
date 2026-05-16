export function safeParseJson<T>(raw: string): T | null {
  const cleaned = stripCodeFence(raw).trim();
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    for (const candidate of extractJsonObjects(cleaned)) {
      try {
        return JSON.parse(candidate) as T;
      } catch {
        // try the next candidate
      }
    }
    return null;
  }
}

function stripCodeFence(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
}

function* extractJsonObjects(text: string): Generator<string> {
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const start = text.indexOf("{", searchFrom);
    if (start === -1) return;
    const end = findMatchingBrace(text, start);
    if (end === -1) {
      // Unbalanced from this position — advance past it and keep searching.
      searchFrom = start + 1;
      continue;
    }
    yield text.slice(start, end + 1);
    searchFrom = end + 1;
  }
}

function findMatchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}
