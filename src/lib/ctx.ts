import type { NextRequest } from 'next/server';
import { db, DB } from './db';
import type { Session } from './session';
import type { Raw } from './html';
import type { Account } from './account';

/** What the PHP pages built in $page[...] */
export interface Page {
  metaTitle?: string;
  metaDescription?: string;
  subTitle?: string;
  content?: string | Raw;
  css?: string | Raw;
  js?: string | Raw;
  response_code?: number;
  nav?: any;
  /** PHP's global $pageTitle (header title); defaults to metaTitle */
  pageTitle?: string;
  backUrl?: string;
  [k: string]: any;
}

export interface UploadedFile {
  name: string;
  type: string;
  size: number;
  buffer: Buffer;
}

export type Result = Page | Response | Record<string, any>;

/** Thrown to emulate PHP's exit(); carries the final response. */
export class Exit {
  constructor(public result: Result) {}
}
export function exit(result: Result = {}): never {
  throw new Exit(result);
}

/** exit(json_encode($x)) */
export function jsonExit(obj: any, status = 200): never {
  throw new Exit(json(obj, status));
}

export const json = (obj: any, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export class Ctx {
  req!: NextRequest;
  method!: string;
  url!: URL;
  /** Route name relative to its area, e.g. "holidays" or "admin/clients" */
  route!: string;
  area!: 'app' | 'admin';
  isSpa!: boolean;
  get!: Record<string, any>;
  post!: Record<string, any>;
  files!: Record<string, UploadedFile[]>;
  session!: Session;
  account!: Account;
  /** $_SESSION */
  S!: Record<string, any>;
  db: DB = db;
  now!: string;
  today!: string;
  isLoggedIn = false;
  userId = 0;
  settings!: Record<string, any>;
  device!: Record<string, any>;
  /** Cookies read from request */
  cookies!: Record<string, string>;
  /** Cookies to set on the response */
  outCookies: { name: string; value: string; opts: Record<string, any> }[] = [];
  headers: Record<string, string> = {};
  /** Clean URL of the current request, used for "current_page" */
  fullUrl!: string;
  ip = '';
  ua = '';

  setCookie(name: string, value: string, opts: Record<string, any> = {}) {
    this.outCookies.push({ name, value, opts });
  }

  /** PHP $_SESSION['msg'] helpers */
  flash(type: string, content: string) {
    this.S.msg = { type, content };
  }
}
