/** Replaces vault/creden.php + the define()s in inc/config.php. Secrets come from environment variables. */
const e = process.env;
const num = (v: string | undefined, d: number) => (v ? parseInt(v, 10) : d);

export const env = {
  PRODUCTION: num(e.PRODUCTION, 0),
  DEBUG: num(e.DEBUG, 1),
  /** Testing aid: put the OTP in the on-screen login message. Defaults to ON while PRODUCTION=0. NEVER enable in production. */
  SHOW_OTP: e.SHOW_OTP !== undefined ? e.SHOW_OTP === '1' : num(e.PRODUCTION, 0) === 0,
  /** Passkey (WebAuthn) login. Off by default: the login page falls straight to OTP. Set PASSKEYS=1 to re-enable. */
  PASSKEYS: e.PASSKEYS === '1',
  SITE_URL: (e.SITE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  SITE_NAME: e.SITE_NAME ?? 'Freshpet',
  MAILFROM: e.MAILFROM ?? 'info@freshpet.in',
  VERSION: '2.2.2',
  SECRET_KEY: e.SECRET_KEY ?? 'dev-only-secret-change-me',
  /** 'mongo' (default): data in MongoDB (MONGO_URL / MONGO_DB). 'mysql': the original MySQL/MariaDB (DB_*), kept for comparison testing. */
  DB_ENGINE: e.DB_ENGINE ?? 'mongo',
  MONGO_URL: e.MONGO_URL ?? 'mongodb://127.0.0.1:27017',
  MONGO_DB: e.MONGO_DB ?? 'freshpet',
  DB_HOST: e.DB_HOST ?? 'localhost',
  DB_PORT: num(e.DB_PORT, 3306),
  DB_NAME: e.DB_NAME ?? 'freshpet',
  DB_USERNAME: e.DB_USERNAME ?? 'root',
  DB_PASSWORD: e.DB_PASSWORD ?? '',
  AI_URL: e.AI_URL ?? '',
  AI_SERVER_KEY: e.AI_SERVER_KEY ?? '',
  WHATSAPP_KEY: e.WHATSAPP_KEY ?? '',
  MSG91_KEY: e.MSG91_KEY ?? '',
  RECAPTCHA_KEY: e.RECAPTCHA_KEY ?? '',
  FIREBASE_SERVICE_ACCOUNT: e.FIREBASE_SERVICE_ACCOUNT ?? '',
  SMTP_HOST: e.SMTP_HOST ?? '',
  SMTP_PORT: num(e.SMTP_PORT, 587),
  SMTP_USER: e.SMTP_USER ?? '',
  SMTP_PASS: e.SMTP_PASS ?? '',
};
