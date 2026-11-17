import { useRef, useState } from 'react';
import type { JSX } from 'react';
import { api, type RankEntry, type RankGroup } from '../api.ts';
import { Page } from '../ui/Page.tsx';
import { DramaCard } from '../ui/DramaCard.tsx';
import { PersonCard } from '../ui/PersonCard.tsx';
import { InfiniteSentinel } from '../ui/InfiniteSentinel.tsx';
import { StateBlock } from '../ui/StateBlock.tsx';
import { usePaged } from '../hooks/usePaged.ts';

export function Rank(): JSX.Element {
  const [content, setContent] = useState('');
  const [board, setBoard] = useState('');
  const [groups, setGroups] = useState<RankGroup[]>([]);
  // 榜单用游标翻页：下一页必须带上一页返回的 cursor
  const cursorRef = useRef('');

  const { items, loading, error, hasMore, moreLoading, loadMore, reload } = usePaged<RankEntry>(
    [content, board],
    async (page, signal) => {
      const res = await api.rank(content, board, page === 1 ? '' : cursorRef.current, signal);
      cursorRef.current = res.cursor;
      if (page === 1) setGroups(res.groups);
      return { items: res.items, page, hasMore: res.hasMore };
    },
    { idOf: (e) => (e.kind === 'series' ? `s-${e.drama.seriesId}` : `a-${e.userId}`) },
  );

  // 未选择时按第一组/第一个榜展示（后端默认值就是这个，不用额外请求）
  const activeGroup = groups.find((g) => g.id === content) ?? groups[0];
  const activeBoard = activeGroup?.boards.some((b) => b.id === board)
    ? board
    : (activeGroup?.boards[0]?.id ?? '');

  return (
    <Page title="榜单" sub="全部 · 真人 · 漫剧 · 演员">
      {groups.length > 0 && (
        <div className="board-tabs" role="tablist" aria-label="榜单分类">
          {groups.map((g) => (
            <button
              key={g.id}
              role="tab"
              aria-selected={g.id === (activeGroup?.id ?? '')}
              className={`chip${g.id === (activeGroup?.id ?? '') ? ' chip--on' : ''}`}
              onClick={() => {
                setContent(g.id);
                setBoard(g.boards[0]?.id ?? '');
              }}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}

      {activeGroup !== undefined && activeGroup.boards.length > 0 && (
        <div className="board-tabs" role="tablist" aria-label="榜单">
          {activeGroup.boards.map((b) => (
            <button
              key={b.id}
              role="tab"
              aria-selected={b.id === activeBoard}
              className={`chip${b.id === activeBoard ? ' chip--on' : ''}`}
              onClick={() => setBoard(b.id)}
            >
              {b.name}
            </button>
          ))}
        </div>
      )}

      <StateBlock loading={loading} error={error} empty={!loading && error === null && items.length === 0} onRetry={reload}>
        <div className="card-grid">
          {items.map((entry, index) => {
            const rank = entry.rank > 0 ? entry.rank : index + 1;
            if (entry.kind === 'actor') {
              return (
                <PersonCard
                  key={`a-${entry.userId}`}
                  rank={rank}
                  score={entry.score}
                  name={entry.name}
                  avatar={entry.avatar}
                  intro={entry.intro}
                />
              );
            }
            return <DramaCard key={`s-${entry.drama.seriesId}`} drama={entry.drama} rank={rank} score={entry.score} />;
          })}
        </div>
        <InfiniteSentinel onReach={loadMore} disabled={!hasMore || loading} />
        <p className="load-more__hint">{moreLoading ? '加载中…' : hasMore ? '继续下滑自动加载' : '没有更多了'}</p>
      </StateBlock>
    </Page>
  );
}
