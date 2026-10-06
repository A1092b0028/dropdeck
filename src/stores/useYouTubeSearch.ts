import { useRef, useState } from 'react';
import { youtubeService, YouTubeSearchError } from '../services/youtube';
import type { MusicProvider } from '../services/music';
import type { SearchState } from '../types/search';

export function useYouTubeSearch(service: MusicProvider = youtubeService) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const inFlight = useRef(false);

  async function search() {
    if (inFlight.current) return;
    inFlight.current = true;
    const submittedQuery = query.trim();
    setState({ status: 'loading', query: submittedQuery });
    try {
      const tracks = await service.search(submittedQuery);
      setState({ status: 'success', query: submittedQuery, tracks });
    } catch (error) {
      setState({
        status: 'error', query: submittedQuery,
        code: error instanceof YouTubeSearchError ? error.code : 'executionFailed',
        message: error instanceof Error ? error.message : '搜尋失敗，請稍後重試。',
      });
    } finally {
      inFlight.current = false;
    }
  }

  return { query, setQuery, state, search };
}
