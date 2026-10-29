declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    VAPID_SUBJECT?: string;
    NOTIFICATION_ACTION_SECRET?: string;
    SCHEDULER_SECRET?: string;
    KAKAO_MAP_JAVASCRIPT_KEY?: string;
    KAKAO_REST_API_KEY?: string;
  }
}
