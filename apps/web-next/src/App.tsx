import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { api } from './api.ts';
import { hashOf, parseHash, parseMini, parsePlay, type MiniRoute, type PlayRoute } from './routes.ts';
import { useApp } from './store.ts';
import { DetailDrawer } from './ui/DetailDrawer.tsx';
import { Dock } from './ui/Dock.tsx';
import { TopBar } from './ui/TopBar.tsx';
import { MiniPlayer } from './views/MiniPlayer.tsx';
import { LoginDialog } from './ui/LoginDialog.tsx';
import { RewardDialog } from './ui/RewardDialog.tsx';
import { ShareDialog } from './ui/ShareDialog.tsx';
import { Play } from './views/Play.tsx';
import { Theater } from './views/Theater.tsx';
import { Feed } from './views/Feed.tsx';
import { NewReleases } from './views/NewReleases.tsx';
import { Rank } from './views/Rank.tsx';
import { Category } from './views/Category.tsx';
import { Library } from './views/Library.tsx';
import { Downloads } from './views/Downloads.tsx';
import { Search } from './views/Search.tsx';
import { Settings } from './views/Settings.tsx';

const VIEWS = {
  theater: Theater,
  feed: Feed,
  newreleases: NewReleases,
  rank: Rank,
  category: Category,
  library: Library,
  downloads: Downloads,
  search: Search,
  settings: Settings,
} as const;

export function App(): JSX.Element {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const setTheme = useApp((s) => s.setTheme);
  const theme = useApp((s) => s.theme);
  const [playRoute, setPlayRoute] = useState<PlayRoute | null>(() => parsePlay(location.hash));
  const [miniRoute, setMiniRoute] = useState<MiniRoute | null>(() => parseMini(location.hash));

  // 主题：store 初始化后立刻落一次，避免首帧闪白
  useEffect(() => {
    setTheme(theme);
  }, [setTheme, theme]);

  // 双向同步 hash：外链/后退可用，旧版链接也能落回对应页面
  useEffect(() => {
    const sync = (): void => {
      setPlayRoute(parsePlay(location.hash));
      setMiniRoute(parseMini(location.hash));
      setView(parseHash(location.hash));
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [setView]);

  // 只在浏览态校正 hash；播放页/小窗的 hash 由它们自己维护
  useEffect(() => {
    if (playRoute !== null || miniRoute !== null) return;
    const want = hashOf(view);
    if (location.hash !== want) history.replaceState(null, '', want);
  }, [view, playRoute, miniRoute]);

  // 切页面时自动收起详情（方案要求：详情抽屉不跨页残留）
  const refreshAccount = useApp((s) => s.refreshAccount);
  const detailId = useApp((s) => s.detailId);
  const closeDetail = useApp((s) => s.closeDetail);
  useEffect(() => {
    closeDetail();
  }, [view, closeDetail]);

  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount]);

  // 启动时同步一次账号历史，首页「继续播放」才能直接对应账号进度
  useEffect(() => {
    void (async () => {
      try {
        const [acc, cfg] = await Promise.all([api.accountStatus(), api.settings()]);
        if (acc.loggedIn && cfg.autoSyncAccount !== false) await api.accountSync(false);
      } catch {
        /* 离线/未登录就不折腾 */
      }
    })();
  }, []);

  const View = VIEWS[view];

  // 小窗：只有迷你播放器，没有任何应用外壳
  if (miniRoute !== null) {
    return <MiniPlayer route={miniRoute} />;
  }

  // 播放页全屏：不显示顶栏 / 底部导航
  if (playRoute !== null) {
    return (
      <>
        <div className="backdrop" />
        <Play route={playRoute} />
        <RewardDialog />
        <ShareDialog />
      </>
    );
  }

  return (
    <>
      <div className="backdrop" />
      <div className="app">
        <TopBar />
        <main className="app__main" data-view={view}>
          <div className="view-stage" key={view}>
            <View />
          </div>
        </main>
        <Dock />
      </div>
      {detailId !== null && <DetailDrawer seriesId={detailId} />}
      <LoginDialog />
      <RewardDialog />
      <ShareDialog />
    </>
  );
}
