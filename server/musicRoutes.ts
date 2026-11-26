import type {Express, Request, Response} from 'express';
import {
  getTrendingTracks,
  sanitizeGenre,
  searchMusicTracks,
} from './musicCore';

export function registerMusicRoutes(app: Express): void {
  app.get('/api/music/trending', async (req: Request, res: Response) => {
    try {
      const genre = sanitizeGenre(req.query.genre);
      const tracks = await getTrendingTracks(genre);
      res.setHeader('Cache-Control', 'public, max-age=120');
      res.json({
        ok: true,
        genre,
        tracks,
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        tracks: [],
        error: err instanceof Error ? err.message : 'Unable to fetch trending songs.',
      });
    }
  });

  app.get('/api/music/search', async (req: Request, res: Response) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (q.length < 2) {
        res.json({ok: true, q, tracks: []});
        return;
      }
      const tracks = await searchMusicTracks(q);
      res.setHeader('Cache-Control', 'public, max-age=90');
      res.json({
        ok: true,
        q,
        tracks,
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        tracks: [],
        error: err instanceof Error ? err.message : 'Music search failed.',
      });
    }
  });
}
