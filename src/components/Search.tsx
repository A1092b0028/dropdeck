interface SearchProps {
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  loading: boolean;
  providerLabel?: string;
}

export function Search({ query, onQueryChange, onSearch, loading, providerLabel = 'YouTube' }: SearchProps) {
  return (
    <form className="search" role="search" aria-label={`${providerLabel} 搜尋`} onSubmit={event => {
      event.preventDefault();
      onSearch();
    }}>
      <span aria-hidden="true">⌕</span>
      <input type="search" placeholder={`搜尋 ${providerLabel} 音樂`} aria-label="搜尋關鍵字"
        value={query} onChange={event => onQueryChange(event.target.value)} required disabled={loading} />
      <button className="search-button" type="submit" disabled={loading || !query.trim()}>
        {loading ? '搜尋中…' : '搜尋'}
      </button>
    </form>
  );
}
