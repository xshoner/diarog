import { db } from "./supabase";

/** Audit metadata only. Never put transcript/diary contents or raw errors in the log. */
export async function recordLearningActivity(userId: string, name: "context_assembled" | "memory_refresh" | "diary_context", props: Record<string, unknown>) {
  try {
    const { error } = await db().from("analytics_events").insert({ user_id: userId, name, props });
    return !error;
  } catch { return false; }
}
