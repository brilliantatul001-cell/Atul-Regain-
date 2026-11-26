export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  previewUrl: string;
  durationSec: number;
  genre: string;
  source: 'itunes' | 'deezer';
}

export type MusicGenre =
  | 'all'
  | 'bollywood'
  | 'pop'
  | 'lofi'
  | 'phonk'
  | 'hiphop'
  | 'instrumental';

interface CacheEntry {
  expiresAt: number;
  tracks: MusicTrack[];
}

const TRENDING_TTL_MS = 10 * 60_000;
const SEARCH_TTL_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 5500;

const trendingCache = new Map<string, CacheEntry>();
const searchCache = new Map<string, CacheEntry>();

function toHttpsUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('http://')) return 'https://' + trimmed.slice(7);
  return '';
}

function upsizeItunesArt(raw: unknown): string {
  const url = toHttpsUrl(raw);
  if (!url) return '';
  return url
    .replace(/\/100x100bb\./i, '/300x300bb.')
    .replace(/\/60x60bb\./i, '/300x300bb.')
    .replace(/\/170x170bb\./i, '/300x300bb.');
}

function normalizeTrackKey(title: string, artist: string): string {
  const t = title.toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]|[^a-z0-9]/g, '');
  const a = artist.toLowerCase().split(/[,&]|feat\.?/i)[0].replace(/[^a-z0-9]/g, '');
  return `${t}|${a}`;
}

function dedupeTracks(list: MusicTrack[], limit = 30): MusicTrack[] {
  const seen = new Set<string>();
  const out: MusicTrack[] = [];
  for (const track of list) {
    if (!track.previewUrl || !track.title) continue;
    const key = normalizeTrackKey(track.title, track.artist);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(track);
    if (out.length >= limit) break;
  }
  return out;
}

async function fetchJsonWithTimeout<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'HourStudyTimer/1.0',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface ItunesTrackRaw {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  artworkUrl60?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
  primaryGenreName?: string;
}

interface ItunesSearchResp {
  results?: ItunesTrackRaw[];
}

function mapItunesTrack(item: ItunesTrackRaw): MusicTrack | null {
  const previewUrl = toHttpsUrl(item.previewUrl);
  const title = typeof item.trackName === 'string' ? item.trackName.trim().slice(0, 80) : '';
  const artist = typeof item.artistName === 'string' ? item.artistName.trim().slice(0, 64) : '';
  if (!previewUrl || !title || !artist) return null;
  const idNum = item.trackId ? String(item.trackId) : normalizeTrackKey(title, artist);
  return {
    id: `it_${idNum}`,
    title,
    artist,
    album: typeof item.collectionName === 'string' ? item.collectionName.trim().slice(0, 80) : '',
    coverUrl: upsizeItunesArt(item.artworkUrl100 || item.artworkUrl60),
    previewUrl,
    durationSec: 30,
    genre: typeof item.primaryGenreName === 'string' ? item.primaryGenreName.trim().slice(0, 32) : 'Music',
    source: 'itunes',
  };
}

interface DeezerTrackRaw {
  id?: number | string;
  title?: string;
  title_short?: string;
  preview?: string;
  artist?: {name?: string};
  album?: {title?: string; cover_medium?: string; cover_big?: string; cover?: string};
}

interface DeezerListResp {
  data?: DeezerTrackRaw[];
}

function mapDeezerTrack(item: DeezerTrackRaw, genre = 'Trending'): MusicTrack | null {
  const previewUrl = toHttpsUrl(item.preview);
  const title = typeof (item.title_short || item.title) === 'string'
    ? String(item.title_short || item.title).trim().slice(0, 80)
    : '';
  const artist = typeof item.artist?.name === 'string' ? item.artist.name.trim().slice(0, 64) : '';
  if (!previewUrl || !title || !artist) return null;
  const coverUrl = toHttpsUrl(item.album?.cover_medium || item.album?.cover_big || item.album?.cover);
  return {
    id: `dz_${String(item.id || normalizeTrackKey(title, artist))}`,
    title,
    artist,
    album: typeof item.album?.title === 'string' ? item.album.title.trim().slice(0, 80) : '',
    coverUrl,
    previewUrl,
    durationSec: 30,
    genre,
    source: 'deezer',
  };
}

async function searchItunes(term: string, country: string, limit = 20): Promise<MusicTrack[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=${limit}&country=${encodeURIComponent(country)}`;
  const data = await fetchJsonWithTimeout<ItunesSearchResp>(url);
  if (!data?.results?.length) return [];
  return data.results
    .map(mapItunesTrack)
    .filter((t): t is MusicTrack => Boolean(t));
}

async function searchDeezer(term: string, limit = 18): Promise<MusicTrack[]> {
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(term)}&limit=${limit}`;
  const data = await fetchJsonWithTimeout<DeezerListResp>(url);
  if (!data?.data?.length) return [];
  return data.data
    .map((item) => mapDeezerTrack(item, 'Search'))
    .filter((t): t is MusicTrack => Boolean(t));
}

interface ItunesRssEntry {
  id?: {attributes?: {'im:id'?: string}};
}

interface ItunesRssResp {
  feed?: {entry?: ItunesRssEntry[]};
}

async function fetchItunesTopChart(country: 'in' | 'us', limit = 25): Promise<MusicTrack[]> {
  const rssUrl = `https://itunes.apple.com/${country}/rss/topsongs/limit=${limit}/json`;
  const rss = await fetchJsonWithTimeout<ItunesRssResp>(rssUrl);
  const ids = (rss?.feed?.entry || [])
    .map((e) => e.id?.attributes?.['im:id'])
    .filter((id): id is string => Boolean(id && /^\d+$/.test(id)))
    .slice(0, 25);
  if (!ids.length) return [];
  const lookupUrl = `https://itunes.apple.com/lookup?id=${ids.join(',')}&country=${country}&entity=song`;
  const lookup = await fetchJsonWithTimeout<ItunesSearchResp>(lookupUrl);
  if (!lookup?.results?.length) return [];
  const byId = new Map<string, MusicTrack>();
  for (const r of lookup.results) {
    const mapped = mapItunesTrack(r);
    if (mapped && r.trackId) {
      byId.set(String(r.trackId), mapped);
    }
  }
  return ids
    .map((id) => byId.get(id))
    .filter((t): t is MusicTrack => Boolean(t));
}

async function fetchDeezerTopChart(limit = 25): Promise<MusicTrack[]> {
  const url = `https://api.deezer.com/chart/0/tracks?limit=${limit}`;
  const data = await fetchJsonWithTimeout<DeezerListResp>(url);
  if (!data?.data?.length) return [];
  return data.data
    .map((item) => mapDeezerTrack(item, 'Global Top'))
    .filter((t): t is MusicTrack => Boolean(t));
}

export function sanitizeGenre(raw: unknown): MusicGenre {
  const g = typeof raw === 'string' ? raw.trim().toLowerCase() : 'all';
  if (
    g === 'bollywood' ||
    g === 'pop' ||
    g === 'lofi' ||
    g === 'phonk' ||
    g === 'hiphop' ||
    g === 'instrumental'
  ) {
    return g;
  }
  return 'all';
}

export async function getTrendingTracks(genre: MusicGenre = 'all'): Promise<MusicTrack[]> {
  const key = `trend:${genre}`;
  const cached = trendingCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tracks;
  }

  let combined: MusicTrack[] = [];
  if (genre === 'all') {
    const [inChart, usChart, dzChart] = await Promise.all([
      fetchItunesTopChart('in', 20),
      fetchItunesTopChart('us', 12),
      fetchDeezerTopChart(20),
    ]);
    // Interleave IN Top + Global Top for rich discovery
    const maxLen = Math.max(inChart.length, dzChart.length, usChart.length);
    for (let i = 0; i < maxLen; i++) {
      if (inChart[i]) combined.push(inChart[i]);
      if (dzChart[i]) combined.push(dzChart[i]);
      if (usChart[i]) combined.push(usChart[i]);
    }
  } else {
    const termMap: Record<Exclude<MusicGenre, 'all'>, string[]> = {
      bollywood: ['arijit singh trending bollywood hits', 'anirudh hindi top hits'],
      pop: ['top pop hits 2025 the weeknd sabrina carpenter', 'billie eilish dua lipa hits'],
      lofi: ['lofi chill study beats', 'lofi hip hop focus instrumental'],
      phonk: ['brazilian phonk drift', 'phonk gym motivation'],
      hiphop: ['kendrick lamar travis scott metro boomin', 'indian hip hop divine karan aujla'],
      instrumental: ['interstellar hans zimmer piano study', 'classical focus piano'],
    };
    const [q1, q2] = termMap[genre];
    const [it1, dz1, it2] = await Promise.all([
      searchItunes(q1, 'IN', 18),
      searchDeezer(q1, 14),
      searchItunes(q2, 'US', 12),
    ]);
    combined = [...it1, ...dz1, ...it2];
  }

  const deduped = dedupeTracks(combined, 30);
  if (deduped.length > 0) {
    trendingCache.set(key, {
      expiresAt: Date.now() + TRENDING_TTL_MS,
      tracks: deduped,
    });
  }
  return deduped;
}

export async function searchMusicTracks(rawQuery: string): Promise<MusicTrack[]> {
  const q = String(rawQuery || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  if (q.length < 2) return [];

  const cacheKey = q.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tracks;
  }

  const [itIn, dz, itUs] = await Promise.all([
    searchItunes(q, 'IN', 20),
    searchDeezer(q, 16),
    searchItunes(q, 'US', 12),
  ]);

  const merged = dedupeTracks([...itIn, ...dz, ...itUs], 30);
  if (merged.length > 0) {
    searchCache.set(cacheKey, {
      expiresAt: Date.now() + SEARCH_TTL_MS,
      tracks: merged,
    });
    if (searchCache.size > 200) {
      const oldestKey = searchCache.keys().next().value;
      if (oldestKey) searchCache.delete(oldestKey);
    }
  }
  return merged;
}
