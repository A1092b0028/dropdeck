// Test-only browser harness. No fixture data is included in the application entry point.
import { createRoot } from 'react-dom/client';
import { Search } from '../src/components/Search';
import { SearchResults } from '../src/components/SearchResults';
import { useYouTubeSearch } from '../src/stores/useYouTubeSearch';
import { createYouTubeService } from '../src/services/youtube';
import '../src/fonts.css';
import '../src/App.css';

const service = createYouTubeService(async (_command, args) => {
  if (!('query' in args)) throw new Error('Search harness does not resolve audio');
  const { query } = args;
  await new Promise(resolve => setTimeout(resolve, 1500));
  if (query === 'empty') return [];
  if (query === 'error') throw { code: 'searchFailed', message: 'YouTube 搜尋失敗，請檢查網路連線或稍後再試。' };
  if (query === 'invalid') return { entries: [] };
  if (query === 'missing') throw { code: 'notInstalled', message: '找不到 yt-dlp，請先安裝並加入 PATH，再重新啟動 Drop Deck。' };
  return [
    { id: 'abcdefghijk', title: '驗證用音樂 — 長標題與 Unicode 🎵', channel: '驗證頻道', duration: 3661,
      thumbnail: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk' },
    { id: 'lmnopqrstuv', title: '直播與未知時長', channel: '未知頻道', duration: null,
      thumbnail: 'https://i.ytimg.com/vi/lmnopqrstuv/hqdefault.jpg', sourceUrl: 'https://www.youtube.com/watch?v=lmnopqrstuv' },
  ];
});

function SearchHarness() {
  const controller = useYouTubeSearch(service);
  return <div className="app">
    <h1>Search UI verification fixtures</h1>
    <p>Test-only transport: results / empty / error / invalid / missing. Responses take 1.5 seconds.</p>
    <Search query={controller.query} onQueryChange={controller.setQuery}
      onSearch={() => void controller.search()} loading={controller.state.status === 'loading'} />
    <SearchResults state={controller.state} />
  </div>;
}

createRoot(document.getElementById('root')!).render(<SearchHarness />);
