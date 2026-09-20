import React, { Suspense, lazy, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useLocation,
} from '@tanstack/react-router';
import {
  Activity,
  ArrowRight,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Package,
  PanelLeftClose,
  Settings2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import '@fontsource-variable/noto-sans';
import '@fontsource-variable/noto-sans-sc';
import './fonts-ui.css';
import './styles.css';
import { queryClient } from './lib/api';
import { SessionProvider, useSession } from './lib/session';
import { Button, ErrorMessage, Loading } from './components/ui';

const Dashboard = lazy(() => import('./pages/dashboard'));
const Customers = lazy(() => import('./pages/customers'));
const Orders = lazy(() => import('./pages/orders'));
const Products = lazy(() => import('./pages/products'));
const Materials = lazy(() => import('./pages/materials'));
const Imports = lazy(() => import('./pages/imports'));
const Settings = lazy(() => import('./pages/settings'));

const navigation = [
  { path: '/dashboard', label: '工作台', icon: LayoutDashboard },
  { path: '/customers', label: '客户管理', icon: Users },
  { path: '/orders', label: '订单管理', icon: ClipboardList },
  { path: '/products', label: '产品清单', icon: Package },
  { path: '/materials', label: '资料库', icon: FolderOpen },
  { path: '/imports', label: '导入记录', icon: Upload },
];
const settingsNavigation = [
  { path: '/settings/accounts', label: '账号管理', icon: Settings2 },
  { path: '/settings/audit', label: '操作记录', icon: Activity },
];

function AppLayout() {
  const { user, logout, changePassword } = useSession();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const current =
    [...navigation, ...settingsNavigation].find((item) =>
      location.pathname.startsWith(item.path),
    ) || navigation[0];
  function nav(items: typeof navigation) {
    return items.map((item) => (
      <Link
        key={item.path}
        to={item.path}
        className={`nav-link ${location.pathname.startsWith(item.path) || (location.pathname === '/' && item.path === '/dashboard') ? 'active' : ''}`}
        aria-current={location.pathname.startsWith(item.path) ? 'page' : undefined}
        title={collapsed ? item.label : undefined}
        onClick={() => setMobileOpen(false)}
      >
        <item.icon size={18} strokeWidth={1.7} />
        <span>{item.label}</span>
        {location.pathname.startsWith(item.path) && <span className="nav-indicator" />}
      </Link>
    ));
  }
  return (
    <div
      className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''} ${mobileOpen ? 'mobile-nav-open' : ''}`}
    >
      <a className="skip-link" href="#main">
        跳至内容
      </a>
      {mobileOpen && (
        <button
          className="mobile-shade"
          aria-label="关闭导航"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className="sidebar">
        <Link to="/dashboard" className="brand">
          <img src="/logo.jpg" alt="" />
          <span>YIJINTOOL</span>
        </Link>
        <nav aria-label="主导航">
          <div className="nav-section-label">业务</div>
          {nav(navigation)}
          {user.role === 'BOSS' && (
            <>
              <div className="nav-section-label settings-label">管理</div>
              {nav(settingsNavigation)}
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <Button
            variant="ghost"
            size="icon"
            aria-label="收起导航"
            onClick={() => setCollapsed(!collapsed)}
          >
            <PanelLeftClose size={16} />
          </Button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <Button
              variant="ghost"
              size="icon"
              className="sidebar-toggle"
              aria-label="切换导航"
              onClick={() => {
                if (window.innerWidth < 1024) setMobileOpen(!mobileOpen);
                else setCollapsed(!collapsed);
              }}
            >
              {mobileOpen ? <X size={18} /> : <MenuIcon size={18} />}
            </Button>
            <span className="breadcrumb-divider" />
            <span>经营管理</span>
            <ArrowRight size={12} />
            <strong>{current.label}</strong>
          </div>
          <Dropdown.Root>
            <Dropdown.Trigger asChild>
              <button className="account-menu">
                <span className="avatar">{user.displayName.slice(0, 1)}</span>
                <span>{user.displayName}</span>
                <ChevronDown size={13} />
              </button>
            </Dropdown.Trigger>
            <Dropdown.Portal>
              <Dropdown.Content
                className="menu-content account-dropdown"
                align="end"
                sideOffset={8}
              >
                <div className="account-summary">
                  <strong>{user.displayName}</strong>
                  <span>{user.role === 'BOSS' ? '企业老板' : '运营人员'}</span>
                </div>
                <Dropdown.Separator className="menu-separator" />
                <Dropdown.Item className="menu-item" onSelect={changePassword}>
                  <CircleHelp size={15} />
                  修改密码
                </Dropdown.Item>
                <Dropdown.Item className="menu-item" onSelect={() => void logout()}>
                  <LogOut size={15} />
                  退出登录
                </Dropdown.Item>
              </Dropdown.Content>
            </Dropdown.Portal>
          </Dropdown.Root>
        </header>
        <main id="main" className="main-content">
          <Suspense fallback={<Loading rows={7} />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
function Root() {
  return (
    <SessionProvider>
      <AppLayout />
    </SessionProvider>
  );
}
function RoutePage() {
  const path = useLocation().pathname;
  if (path === '/customers') return <Customers />;
  if (/^\/orders(?:\/[^/]+(?:\/edit)?)?$/.test(path)) return <Orders />;
  if (path === '/products') return <Products />;
  if (path === '/materials') return <Materials />;
  if (path === '/imports') return <Imports />;
  if (path === '/settings/accounts' || path === '/settings/audit') return <Settings />;
  if (path === '/dashboard') return <Dashboard />;
  return (
    <>
      <ErrorMessage error="页面不可用" />
      <Link to="/dashboard" className="button button-outline">
        返回工作台
      </Link>
    </>
  );
}
const routeError = () => (
  <div className="main-content">
    <ErrorMessage error="页面加载失败" retry={() => window.location.reload()} />
  </div>
);
const rootRoute = createRootRoute({ component: Root, errorComponent: routeError });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Dashboard,
  errorComponent: routeError,
});
const catchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$',
  component: RoutePage,
  errorComponent: routeError,
});
const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, catchRoute]),
  defaultPreload: 'intent',
  scrollRestoration: true,
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
