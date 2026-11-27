declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    VISITOR_SALT: string;
    ALLOWED_ORIGINS: string;
    SITE_ORIGIN: string;
    CHECK_PAGES: string;
  }
}
