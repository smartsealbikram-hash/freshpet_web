import type { NextRequest } from 'next/server';
import { handle } from '@/lib/server';

// The PHP app was a file-per-page site routed by index.php. This single catch-all
// plays the same role: it resolves /foo -> src/modules/foo.ts (and /admin/foo -> src/modules/admin/foo.ts).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = (req: NextRequest) => handle(req);
export const POST = (req: NextRequest) => handle(req);
export const PUT = (req: NextRequest) => handle(req);
export const DELETE = (req: NextRequest) => handle(req);
