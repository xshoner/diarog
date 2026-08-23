import webpush from "web-push";
import { env } from "./env";
import { db } from "./supabase";

let configured = false;
function setup() {
  if (!configured) {
    webpush.setVapidDetails("mailto:noreply@diarog.app", env.vapidPublic(), env.vapidPrivate());
    configured = true;
  }
}

export async function sendPush(userId: string, payload: { title: string; body: string; url?: string }): Promise<boolean> {
  setup();
  const { data: profile } = await db().from("users_profile")
    .select("push_subscription").eq("user_id", userId).single();
  const sub = profile?.push_subscription;
  if (!sub?.endpoint) return false;
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600 });
    return true;
  } catch (e: unknown) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      // 구독 만료 → 제거
      await db().from("users_profile").update({ push_subscription: null }).eq("user_id", userId);
    }
    return false;
  }
}
