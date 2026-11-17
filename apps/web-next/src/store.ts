import { create } from 'zustand';
import { api, type AccountStatus } from './api.ts';

/** 视图：与旧版的 9 个 hash 路由对齐，详情/播放后续作为独立层叠加。 */
export type View =
  | 'theater'
  | 'feed'
  | 'newreleases'
  | 'rank'
  | 'category'
  | 'library'
  | 'downloads'
  | 'search'
  | 'settings';

export type Theme = 'dark' | 'light';
export type Accent = 'ember' | 'jade' | 'violet' | 'azure';
export type LibraryTab = 'fav' | 'history' | 'likes' | 'follow';

interface AppState {
  view: View;
  theme: Theme;
  accent: Accent;
  /** 新核心连上了没有：null=未知 */
  coreOk: boolean | null;
  /** 账号状态：null=还没查 */
  account: AccountStatus | null;
  /** 登录弹窗开关 */
  loginOpen: boolean;
  /** 打赏弹窗开关 */
  rewardOpen: boolean;
  openReward: () => void;
  closeReward: () => void;
  /** 「分享续播」弹窗开关（复制本集链接 / 解析别人分享的红果链接） */
  shareOpen: boolean;
  openShare: () => void;
  closeShare: () => void;
  refreshAccount: () => Promise<void>;
  openLogin: () => void;
  closeLogin: () => void;
  /** 当前打开的详情（剧 id）；null=关闭 */
  detailId: string | null;
  setView: (view: View) => void;
  /** 打开追剧页时默认选中的 tab（侧栏「追更/预约」用） */
  libraryTab: LibraryTab;
  setLibraryTab: (tab: LibraryTab) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setAccent: (accent: Accent) => void;
  setCoreOk: (ok: boolean) => void;
  setAccount: (account: AccountStatus | null) => void;
  openDetail: (seriesId: string) => void;
  closeDetail: () => void;
}

function readTheme(): Theme {
  const saved = localStorage.getItem('horun-theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function readAccent(): Accent {
  const saved = localStorage.getItem('horun-accent');
  if (saved === 'ember' || saved === 'jade' || saved === 'violet' || saved === 'azure') return saved;
  return 'ember';
}

const initialTheme = readTheme();
const initialAccent = readAccent();
document.documentElement.dataset.theme = initialTheme;
document.documentElement.dataset.accent = initialAccent;

/** 桌面壳里才有的东西：右上角窗口按钮的样式与拖动区（见 styles.css）。 */
function syncShell(): void {
  document.documentElement.dataset.shell = window.yimu === undefined ? 'web' : 'electron';
}

export const useApp = create<AppState>((set, get) => ({
  view: 'theater',
  theme: initialTheme,
  accent: initialAccent,
  coreOk: null,
  account: null,
  loginOpen: false,
  detailId: null,
  libraryTab: 'fav',
  setView: (view) => set({ view }),
  setLibraryTab: (libraryTab) => set({ libraryTab }),
  setTheme: (theme) => {
    localStorage.setItem('horun-theme', theme);
    document.documentElement.dataset.theme = theme;
    syncShell();
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  setAccent: (accent) => {
    localStorage.setItem('horun-accent', accent);
    document.documentElement.dataset.accent = accent;
    set({ accent });
  },
  setCoreOk: (coreOk) => set({ coreOk }),
  setAccount: (account) => set({ account }),
  refreshAccount: async () => {
    try {
      const account = await api.accountStatus();
      set({ account });
    } catch {
      set({ account: null });
    }
  },
  openLogin: () => set({ loginOpen: true }),
  rewardOpen: false,
  openReward: () => set({ rewardOpen: true }),
  closeReward: () => set({ rewardOpen: false }),
  shareOpen: false,
  openShare: () => set({ shareOpen: true }),
  closeShare: () => set({ shareOpen: false }),
  closeLogin: () => set({ loginOpen: false }),
  openDetail: (seriesId) => set({ detailId: seriesId }),
  closeDetail: () => set({ detailId: null }),
}));
