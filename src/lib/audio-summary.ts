/** Validate provider output independently of client input: failures must remain retryable. */
export function audioSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid AI summary");
  const result = value as Record<string, unknown>;
  if (typeof result.summary !== "string" || !result.summary.trim()) throw new Error("empty AI summary");
  const fields: Record<string, string[]> = {};
  for (const key of ["people", "topics", "promises", "todos"]) {
    fields[key] = Array.isArray(result[key]) ? result[key].filter((v): v is string => typeof v === "string")
      .map((v) => v.trim().slice(0, 500)).filter(Boolean).slice(0, 20) : [];
  }
  return {
    title: typeof result.title === "string" && result.title.trim() ? result.title.trim().slice(0, 300) : "통화 요약",
    summary: result.summary.trim().slice(0, 8000), fields,
  };
}
