import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { CartProvider } from './context/CartContext';

// Critical path — loaded eagerly (client-facing, QR scan entry point)
import ClientMenuPage from './features/client/MenuPage';
import CartPage from './features/client/CartPage';
import HomePage from './pages/HomePage';

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

function PageLoader() {
  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <CartProvider>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/upload" element={<OCRUploadPage />} />
          <Route path="/menus/:menuId/edit" element={<MenuEditorPage />} />
          <Route path="/menus/:menuId/translate" element={<TranslatorPage />} />
          <Route path="/tables/:menuSlug" element={<TablesPage />} />
          <Route path="/restaurant/dashboard" element={<RestaurantDashboardPage />} />
          <Route path="/restaurant/:slug/settings" element={<RestaurantSettingsPage />} />
          <Route path="/menu/:slug" element={<ClientMenuPage />} />
          <Route path="/menu/:slug/cart" element={<CartPage />} />
          <Route path="/menu/:slug/tip" element={<TipPage />} />
          <Route path="/menu/:slug/checkout" element={<CheckoutPage />} />
          <Route path="/menu/:slug/thank-you" element={<ThankYouPage />} />
          <Route path="/dashboard" element={<RestaurantDashboardPage />} />
          <Route path="/dashboard/:slug" element={<DashboardConversationsPage />} />
          <Route path="/kds/:slug" element={<KitchenScreen />} />
          <Route path="/analytics" element={<DashboardChartsPage />} />
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/upgrade" element={<UpgradePage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/restaurant/subscription" element={<SubscriptionPage />} />
        </Routes>
      </Suspense>
    </CartProvider>
  );
}
