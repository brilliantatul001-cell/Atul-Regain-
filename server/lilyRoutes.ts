import express, {type Express, type Request, type Response} from 'express';
import {
  LILY_MODEL,
  formatGeminiHttpError,
  isLilyConfigured,
  sanitizeLilyRequest,
  streamLilyReply,
  generateLilyReply,
} from './lilyCore';

export function registerLilyRoutes(app: Express): void {
  const jsonParser = express.json({limit: '256kb'});

  app.get('/api/lily/status', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      configured: isLilyConfigured(),
      model: LILY_MODEL,
    });
  });

  app.post('/api/lily/chat', jsonParser, async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;

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

    if (body.stream === false) {
      try {
        const reply = await generateLilyReply(parsed);
        res.json({ok: true, model: LILY_MODEL, reply});
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
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof (res as unknown as {flushHeaders?: () => void}).flushHeaders === 'function') {
      (res as unknown as {flushHeaders: () => void}).flushHeaders();
    }

    try {
      await streamLilyReply(
        parsed,
        (delta) => {
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({delta})}\n\n`);
          }
        },
        abortController.signal,
      );
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({done: true, model: LILY_MODEL})}\n\n`);
        res.end();
      }
    } catch (err) {
      const formatted = formatGeminiHttpError(err);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({error: formatted.message, code: formatted.code})}\n\n`);
        res.end();
      }
    }
  });
}
