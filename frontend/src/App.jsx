import { Routes, Route } from 'react-router-dom';
import { CartProvider } from './context/CartContext';
import ClientMenuPage from './features/client/MenuPage';
import HomePage from './pages/HomePage';
import CartPage from './features/client/CartPage';
import DashboardPage from './pages/DashboardPage';
import DashboardConversationsPage from './pages/DashboardConversationsPage';
import OCRUploadPage from './features/menu/OCRUploadPage';
import MenuEditorPage from './features/menu/MenuEditorPage';
import TranslatorPage from './features/menu/TranslatorPage';
import TablesPage from './features/restaurant/TablesPage';
import RestaurantDashboardPage from './features/restaurant/DashboardPage';
import RestaurantSettingsPage from './features/restaurant/RestaurantSettingsPage';
import CheckoutPage from './features/payment/CheckoutPage';
import TipPage from './features/payment/TipPage';
import ThankYouPage from './features/payment/ThankYouPage';
import SplitBillPage from './features/payment/SplitBillPage';
import KitchenScreen from './features/kds/KitchenScreen';
import DashboardChartsPage from './features/analytics/DashboardChartsPage';

export default function App() {
  return (
    <CartProvider>
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
        <Route path="/menu/:slug/split" element={<SplitBillPage />} />
        <Route path="/menu/:slug/thank-you" element={<ThankYouPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/dashboard/:slug" element={<DashboardConversationsPage />} />
        <Route path="/kds/:slug" element={<KitchenScreen />} />
        <Route path="/analytics" element={<DashboardChartsPage />} />
      </Routes>
    </CartProvider>
  );
}
