import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { ClerkProvider } from '@clerk/clerk-react';
import { CartProvider } from './context/CartContext';
import { UserRoleProvider } from './context/UserRoleContext';

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Critical path — loaded eagerly (client-facing, QR scan entry point)
import ClientMenuPage from './features/client/MenuPage';
import CartPage from './features/client/CartPage';
import HomePage from './pages/HomePage';
import RequireAuth from './components/RequireAuth';
import RequireOwner from './components/RequireOwner';

// Lazy-load everything else (dashboard, admin, payment, KDS, etc.)
const DashboardConversationsPage = lazy(() => import('./pages/DashboardConversationsPage'));
const OCRUploadPage = lazy(() => import('./features/menu/OCRUploadPage'));
const MenuEditorPage = lazy(() => import('./features/menu/MenuEditorPage'));
const TranslatorPage = lazy(() => import('./features/menu/TranslatorPage'));
const TablesPage = lazy(() => import('./features/restaurant/TablesPage'));
const RestaurantDashboardPage = lazy(() => import('./features/restaurant/DashboardPage'));
const RestaurantSettingsPage = lazy(() => import('./features/restaurant/RestaurantSettingsPage'));
const CheckoutPage = lazy(() => import('./features/payment/CheckoutPage'));
const TipPage = lazy(() => import('./features/payment/TipPage'));
const ThankYouPage = lazy(() => import('./features/payment/ThankYouPage'));
const KitchenScreen = lazy(() => import('./features/kds/KitchenScreen'));
const DashboardChartsPage = lazy(() => import('./features/analytics/DashboardChartsPage'));
const AdminDashboardPage = lazy(() => import('./features/admin/AdminDashboardPage'));
const UpgradePage = lazy(() => import('./features/payment/UpgradePage'));
const OnboardingPage = lazy(() => import('./features/restaurant/OnboardingPage'));
const SubscriptionPage = lazy(() => import('./features/restaurant/SubscriptionPage'));
const WaiterPage = lazy(() => import('./features/waiter/WaiterPage'));
const AccountPage = lazy(() => import('./features/client/AccountPage'));

function PageLoader() {
  return (
    <div className="min-h-dvh bg-neutral-50 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" role="status">
        <span className="sr-only">Chargement…</span>
      </div>
    </div>
  );
}

function AppRoutes() {
  return (
    <CartProvider>
      <UserRoleProvider>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public */}
            <Route path="/" element={<HomePage />} />
            <Route path="/menu/:slug" element={<ClientMenuPage />} />
            <Route path="/menu/:slug/cart" element={<CartPage />} />
            <Route path="/menu/:slug/tip" element={<TipPage />} />
            <Route path="/menu/:slug/checkout" element={<CheckoutPage />} />
            <Route path="/menu/:slug/thank-you" element={<ThankYouPage />} />
            <Route path="/kds/:slug" element={<KitchenScreen />} />

            {/* Client */}
            <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />

            {/* Serveur */}
            <Route path="/waiter" element={<RequireAuth><WaiterPage /></RequireAuth>} />

            {/* Restaurateur uniquement */}
            <Route path="/upload" element={<RequireOwner><OCRUploadPage /></RequireOwner>} />
            <Route path="/menus/:menuId/edit" element={<RequireOwner><MenuEditorPage /></RequireOwner>} />
            <Route path="/menus/:menuId/translate" element={<RequireOwner><TranslatorPage /></RequireOwner>} />
            <Route path="/tables/:menuSlug" element={<RequireOwner><TablesPage /></RequireOwner>} />
            <Route path="/restaurant/dashboard" element={<RequireOwner><RestaurantDashboardPage /></RequireOwner>} />
            <Route path="/restaurant/:slug/settings" element={<RequireOwner><RestaurantSettingsPage /></RequireOwner>} />
            <Route path="/restaurant/subscription" element={<RequireOwner><SubscriptionPage /></RequireOwner>} />
            <Route path="/dashboard" element={<RequireOwner><RestaurantDashboardPage /></RequireOwner>} />
            <Route path="/dashboard/:slug" element={<RequireOwner><DashboardConversationsPage /></RequireOwner>} />
            <Route path="/analytics" element={<RequireOwner><DashboardChartsPage /></RequireOwner>} />
            <Route path="/admin" element={<RequireAuth><AdminDashboardPage /></RequireAuth>} />
            <Route path="/upgrade" element={<RequireOwner><UpgradePage /></RequireOwner>} />
            <Route path="/onboarding" element={<RequireOwner><OnboardingPage /></RequireOwner>} />
          </Routes>
        </Suspense>
      </UserRoleProvider>
    </CartProvider>
  );
}

export default function App() {
  if (CLERK_KEY) {
    return (
      <ClerkProvider publishableKey={CLERK_KEY}>
        <AppRoutes />
      </ClerkProvider>
    );
  }
  return <AppRoutes />;
}
