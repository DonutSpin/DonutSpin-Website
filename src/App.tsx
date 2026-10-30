import { useEffect } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Compass, Gem } from 'lucide-react';
import { AppShell, GuestOnly, RequireAuth, RequirePermission } from './components/layout';
import { Button } from './components/ui';
import { useAuth } from './context/AuthContext';
import { MaintenancePage } from './pages/maintenance';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from './pages/auth';
import { HomePage } from './pages/home';
import { RewardsPage } from './pages/rewards';
import { VerifyEmailPage } from './pages/verify-email';
import { DeleteAccountPage } from './pages/delete-account';
import { GamesPage } from './pages/games/games-page';
import { CoinflipPage } from './pages/games/coinflip-page';
import { MinesPage } from './pages/games/mines-page';
import { BlackjackPage } from './pages/games/blackjack-page';
import { RoulettePage } from './pages/games/roulette-page';
import { TowersPage } from './pages/games/towers-page';
import { PlinkoPage } from './pages/games/plinko-page';
import { TransactionsPage, WalletPage } from './pages/wallet';
import { CashierDetailPage, CashierPage } from './pages/cashier';
import { NewTicketPage, TicketDetailPage, TicketsPage } from './pages/tickets';
import { NotificationsPage } from './pages/notifications';
import { SettingsPage } from './pages/settings';
import { StaffActivityPage, StaffInboxPage, StaffOverviewPage } from './pages/staff';
import { AccountReviewsPage } from './pages/reviews';
import { AdminOverviewPage } from './pages/admin/overview';
import { AdminUserDetailPage, AdminUsersPage } from './pages/admin/users';
import { AdminEconomyPage, AdminStaffPage, AdminTicketsPage, AdminTransactionsPage } from './pages/admin/operations';
import { AdminCashierDetailPage, AdminCashierPage } from './pages/admin/cashier';
import { AdminAnnouncementsPage, AdminAuditPage, AdminGamesPage, AdminSettingsPage } from './pages/admin/platform';
import { AdminRewardsPage } from './pages/admin/rewards';
import { AdminEmailPage } from './pages/admin/email';
import { LegalConsentPage, LegalPage } from './pages/legal';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
}

function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl border border-gold/25 bg-gold/8">
        <Compass className="h-7 w-7 text-gold" />
      </div>
      <p className="mt-6 font-display text-[13px] tracking-[0.2em] text-faint">404</p>
      <h1 className="mt-1 font-display text-2xl font-semibold text-ink">This table doesn't exist</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        The page may have moved, or the link may be incorrect. Your wallet is untouched.
      </p>
      <div className="mt-6 flex gap-2">
        <Link to="/">
          <Button variant="primary">Back to lobby</Button>
        </Link>
        <Link to="/games">
          <Button variant="secondary">Browse games</Button>
        </Link>
      </div>
    </div>
  );
}

function App() {
  const { user, config, loading } = useAuth();
  const location = useLocation();
  const isLegalPath = ['/terms', '/privacy', '/responsible-gambling'].includes(location.pathname);

  if (!loading && user?.legalAcceptanceRequired && !isLegalPath) {
    return <LegalConsentPage />;
  }

  if (!loading && user && config?.maintenance && user.role === 'user' && !isLegalPath) {
    return <MaintenancePage />;
  }

  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/terms" element={<LegalPage kind="terms" />} />
        <Route path="/privacy" element={<LegalPage kind="privacy" />} />
        <Route path="/responsible-gambling" element={<LegalPage kind="responsible-gambling" />} />
        <Route path="/legal-consent" element={<Navigate to="/" replace />} />
        <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
        <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
        <Route path="/forgot-password" element={<GuestOnly><ForgotPasswordPage /></GuestOnly>} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route
          path="/delete-account"
          element={
            <RequireAuth>
              <DeleteAccountPage />
            </RequireAuth>
          }
        />

        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<HomePage />} />
          <Route path="games" element={<GamesPage />} />
          <Route path="rewards" element={<RewardsPage />} />
          <Route path="games/coinflip" element={<CoinflipPage />} />
          <Route path="games/mines" element={<MinesPage />} />
          <Route path="games/blackjack" element={<BlackjackPage />} />
          <Route path="games/roulette" element={<RoulettePage />} />
          <Route path="games/towers" element={<TowersPage />} />
          <Route path="games/plinko" element={<PlinkoPage />} />
          <Route path="wallet" element={<WalletPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="cashier" element={<CashierPage />} />
          <Route path="cashier/:reference" element={<CashierDetailPage />} />
          <Route path="tickets" element={<TicketsPage />} />
          <Route path="tickets/new" element={<NewTicketPage />} />
          <Route path="tickets/:reference" element={<TicketDetailPage mode="user" />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="settings" element={<SettingsPage />} />

          <Route
            path="staff"
            element={
              <RequirePermission permission="staff.access">
                <StaffOverviewPage />
              </RequirePermission>
            }
          />
          <Route
            path="staff/inbox"
            element={
              <RequirePermission permission="staff.access">
                <StaffInboxPage preset="inbox" />
              </RequirePermission>
            }
          />
          <Route
            path="staff/assigned"
            element={
              <RequirePermission permission="staff.access">
                <StaffInboxPage preset="assigned" />
              </RequirePermission>
            }
          />
          <Route
            path="staff/unassigned"
            element={
              <RequirePermission permission="staff.access">
                <StaffInboxPage preset="unassigned" />
              </RequirePermission>
            }
          />
          <Route
            path="staff/on-hold"
            element={
              <RequirePermission permission="staff.access">
                <StaffInboxPage preset="on-hold" />
              </RequirePermission>
            }
          />
          <Route
            path="staff/closed"
            element={
              <RequirePermission permission="staff.access">
                <StaffInboxPage preset="closed" />
              </RequirePermission>
            }
          />
          <Route
            path="staff/search"
            element={
              <RequirePermission permission="staff.access">
                <StaffInboxPage preset="search" />
              </RequirePermission>
            }
          />
          <Route
            path="staff/reviews"
            element={
              <RequirePermission permission="accounts.review">
                <AccountReviewsPage />
              </RequirePermission>
            }
          />
          <Route
            path="staff/activity"
            element={
              <RequirePermission permission="staff.access">
                <StaffActivityPage />
              </RequirePermission>
            }
          />
          <Route
            path="staff/tickets/:reference"
            element={
              <RequirePermission permission="staff.access">
                <TicketDetailPage mode="staff" />
              </RequirePermission>
            }
          />

          <Route
            path="admin"
            element={
              <RequirePermission permission="admin.access">
                <AdminOverviewPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/users"
            element={
              <RequirePermission permission="users.read">
                <AdminUsersPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/users/:id"
            element={
              <RequirePermission permission="users.read">
                <AdminUserDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/reviews"
            element={
              <RequirePermission permission="accounts.review">
                <AccountReviewsPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/staff"
            element={
              <RequirePermission permission="staff.manage">
                <AdminStaffPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/tickets"
            element={
              <RequirePermission permission="admin.access">
                <AdminTicketsPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/tickets/:reference"
            element={
              <RequirePermission permission="admin.access">
                <TicketDetailPage mode="admin" />
              </RequirePermission>
            }
          />
          <Route
            path="admin/cashier"
            element={
              <RequirePermission permission="credits.adjust">
                <AdminCashierPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/cashier/:reference"
            element={
              <RequirePermission permission="credits.adjust">
                <AdminCashierDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/economy"
            element={
              <RequirePermission permission="economy.read">
                <AdminEconomyPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/transactions"
            element={
              <RequirePermission permission="economy.read">
                <AdminTransactionsPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/games"
            element={
              <RequirePermission permission="games.manage">
                <AdminGamesPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/announcements"
            element={
              <RequirePermission permission="notifications.broadcast">
                <AdminAnnouncementsPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/audit"
            element={
              <RequirePermission permission="audit.read">
                <AdminAuditPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/rewards"
            element={
              <RequirePermission permission="settings.manage">
                <AdminRewardsPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/email"
            element={
              <RequirePermission permission="settings.manage">
                <AdminEmailPage />
              </RequirePermission>
            }
          />
          <Route
            path="admin/settings"
            element={
              <RequirePermission permission="settings.manage">
                <AdminSettingsPage />
              </RequirePermission>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}

export default App;

export { Gem };
