import {
  getTrendingTracks,
  sanitizeGenre,
  searchMusicTracks,
} from '../../server/musicCore';

interface ApiRequest {
  method?: string;
  url?: string;
  query?: Record<string, string | string[] | undefined>;
}

interface ApiResponse {
  status: (code: number) => ApiResponse;
  json: (data: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
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

function parseQueryParam(req: ApiRequest, key: string): string {
  const val = req.query?.[key];
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  const rawQs = (req.url || '').split('?')[1] || '';
  if (!rawQs) return '';
  return new URLSearchParams(rawQs).get(key) || '';
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ok: false, error: 'Method not allowed'});
    return;
  }

  const action = parseAction(req);
  if (action === 'trending') {
    try {
      const genre = sanitizeGenre(parseQueryParam(req, 'genre'));
      const tracks = await getTrendingTracks(genre);
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
      res.status(200).json({ok: true, genre, tracks});
    } catch (err) {
      res.status(502).json({
        ok: false,
        tracks: [],
        error: err instanceof Error ? err.message : 'Unable to load trending songs.',
      });
    }
    return;
  }

  if (action === 'search') {
    try {
      const q = parseQueryParam(req, 'q').trim();
      if (q.length < 2) {
        res.status(200).json({ok: true, q, tracks: []});
        return;
      }
      const tracks = await searchMusicTracks(q);
      res.setHeader('Cache-Control', 'public, s-maxage=90, stale-while-revalidate=180');
      res.status(200).json({ok: true, q, tracks});
    } catch (err) {
      res.status(502).json({
        ok: false,
        tracks: [],
        error: err instanceof Error ? err.message : 'Music search failed.',
      });
    }
    return;
  }

  res.status(404).json({ok: false, error: `Unknown music endpoint: ${action}`});
}
