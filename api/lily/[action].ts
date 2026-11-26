import {
  LILY_MODEL,
  formatGeminiHttpError,
  generateLilyReply,
  isLilyConfigured,
  sanitizeLilyRequest,
  streamLilyReply,
} from '../../server/lilyCore';

interface ApiRequest {
  method?: string;
  url?: string;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
  on?: (event: string, listener: () => void) => void;
}

interface ApiResponse {
  status: (code: number) => ApiResponse;
  json: (data: unknown) => void;
  setHeader: (name: string, value: string) => void;
  write?: (chunk: string) => boolean;
  end: (body?: string) => void;
  on?: (event: string, listener: () => void) => void;
  writableEnded?: boolean;
}

function parseAction(req: ApiRequest): string {
  const qAction = req.query?.action;
  if (typeof qAction === 'string' && qAction.trim()) {
    return qAction.trim().toLowerCase();
  }
  if (Array.isArray(qAction) && qAction[0]) {
    return String(qAction[0]).trim().toLowerCase();
  }
  const rawUrl = (req.url || '').split('?')[0];
  const segs = rawUrl.split('/').filter(Boolean);
  return (segs[segs.length - 1] || '').toLowerCase();
}

function parseBody(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === 'object') {
    return raw as Record<string, unknown>;
  }
  return {};
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const action = parseAction(req);

  if (action === 'status') {
    res.status(200).json({
      ok: true,
      mode: 'vercel',
      configured: isLilyConfigured(),
      model: LILY_MODEL,
    });
    return;
  }

  if (action === 'chat') {
    if (req.method !== 'POST') {
      res.status(405).json({ok: false, error: 'Method not allowed. Use POST.'});
      return;
    }

    const body = parseBody(req.body);
    let parsed;
    try {
      parsed = sanitizeLilyRequest(body);
    } catch (err) {
      const formatted = formatGeminiHttpError(err);
      res.status(formatted.status).json({
        ok: false,
        code: formatted.code,
        error: formatted.message,
      });
      return;
    }

    const canStream = body.stream !== false && typeof res.write === 'function';
    if (!canStream) {
      try {
        const reply = await generateLilyReply(parsed);
        res.status(200).json({ok: true, model: LILY_MODEL, reply});
      } catch (err) {
        const formatted = formatGeminiHttpError(err);
        res.status(formatted.status).json({
          ok: false,
          code: formatted.code,
          error: formatted.message,
        });
      }
      return;
    }

    const abortController = new AbortController();
    if (typeof res.on === 'function') {
      res.on('close', () => {
        if (!res.writableEnded) abortController.abort();
      });
    } else if (typeof req.on === 'function') {
      req.on('aborted', () => abortController.abort());
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      await streamLilyReply(
        parsed,
        (delta) => {
          if (!res.writableEnded && typeof res.write === 'function') {
            res.write(`data: ${JSON.stringify({delta})}\n\n`);
          }
        },
        abortController.signal,
      );
      if (!res.writableEnded && typeof res.write === 'function') {
        res.write(`data: ${JSON.stringify({done: true, model: LILY_MODEL})}\n\n`);
      }
      if (!res.writableEnded) {
        res.end();
      }
    } catch (err) {
      const formatted = formatGeminiHttpError(err);
      if (!res.writableEnded && typeof res.write === 'function') {
        res.write(`data: ${JSON.stringify({error: formatted.message, code: formatted.code})}\n\n`);
      }
      if (!res.writableEnded) {
        res.end();
      }
    }
    return;
  }

  res.status(404).json({ok: false, error: `Unknown lily endpoint: ${action}`});
}
