const API_BASE = '';

// Generate or get session ID for conversation memory
function getSessionId() {
  let sessionId = localStorage.getItem('chat_session_id');
  if (!sessionId) {
    sessionId = 'session_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    localStorage.setItem('chat_session_id', sessionId);
  }
  return sessionId;
}

export const api = {
  getSessionId,
  
  async getMenu(slug, lang = 'en') {
    const res = await fetch(`${API_BASE}/api/public/menus/${slug}?lang=${lang}`);
    if (!res.ok) throw new Error('Menu not found');
    return res.json();
  },
  
  async getConversation(slug) {
    const sessionId = getSessionId();
    const res = await fetch(`${API_BASE}/api/public/menus/${slug}/conversation?session_id=${sessionId}`);
    if (!res.ok) return { messages: [] };
    return res.json();
  },
  
  async clearConversation(slug) {
    const sessionId = getSessionId();
    await fetch(`${API_BASE}/api/public/menus/${slug}/conversation?session_id=${sessionId}`, {
      method: 'DELETE'
    });
  },

  async chat(slug, messages, lang = 'en') {
    const sessionId = getSessionId();
    const res = await fetch(`${API_BASE}/api/public/menus/${slug}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, lang, session_id: sessionId }),
    });
    if (!res.ok) throw new Error('Chat error');
    return res.json();
  },

  async *chatStream(slug, messages, lang = 'en') {
    const sessionId = getSessionId();
    const res = await fetch(`${API_BASE}/api/public/menus/${slug}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, lang, session_id: sessionId }),
    });
    
    if (!res.ok) throw new Error('Chat error');
    
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          if (data.startsWith('[ERROR]')) throw new Error(data);
          yield data;
        }
      }
    }
  },

  async uploadMenu(restaurantName, pdfFile, languages = 'en,fr,es') {
    const formData = new FormData();
    formData.append('restaurant_name', restaurantName);
    formData.append('languages', languages);
    formData.append('pdf', pdfFile);
    
    const res = await fetch(`${API_BASE}/api/menus`, {
      method: 'POST',
      body: formData,
    });
    const raw = await res.text();
    let payload = null;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch (_err) {
        payload = null;
      }
    }

    if (!res.ok) {
      throw new Error(payload?.detail || payload?.message || `Upload failed (${res.status})`);
    }

    if (!payload) {
      throw new Error('Upload failed: empty server response');
    }

    return payload;
  },

  // v1 async upload — returns {menu_id, slug, status}
  async uploadMenuAsync(restaurantName, file) {
    const formData = new FormData();
    formData.append('restaurant_name', restaurantName);
    formData.append('file', file);

    const res = await fetch(`${API_BASE}/api/v1/menus/upload`, {
      method: 'POST',
      body: formData,
    });
    const raw = await res.text();
    let payload = null;
    try { payload = JSON.parse(raw); } catch { /* noop */ }
    if (!res.ok) {
      throw new Error(payload?.detail || `Upload failed (${res.status})`);
    }
    return payload;
  },

  // Poll OCR status — returns {menu_id, slug, status, ocr_error?, menu_data?}
  async getMenuStatus(menuId) {
    const res = await fetch(`${API_BASE}/api/v1/menus/${menuId}/status`);
    if (!res.ok) throw new Error(`Status check failed (${res.status})`);
    return res.json();
  },

  // Editor: load full menu data
  async getMenuById(menuId) {
    const res = await fetch(`${API_BASE}/api/v1/menus/${menuId}`);
    if (!res.ok) throw new Error(`Menu not found (${res.status})`);
    return res.json();
  },

  // Editor: save sections/wines
  async updateMenu(menuId, body) {
    const res = await fetch(`${API_BASE}/api/v1/menus/${menuId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Save failed (${res.status})`);
    }
    return res.json();
  },

  // Editor: toggle publish status ('draft' | 'published')
  async publishMenu(menuId, publishStatus) {
    const params = new URLSearchParams({ publish_status: publishStatus });
    const res = await fetch(`${API_BASE}/api/v1/menus/${menuId}/publish?${params}`, {
      method: 'PATCH',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Publish failed (${res.status})`);
    }
    return res.json();
  },

  // Editor: duplicate a menu — returns { menu_id, slug }
  async duplicateMenu(menuId) {
    const res = await fetch(`${API_BASE}/api/v1/menus/${menuId}/duplicate`, {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Duplicate failed (${res.status})`);
    }
    return res.json();
  },

  // Tables
  async createTablesBulk(body) {
    const res = await fetch(`${API_BASE}/api/v1/tables/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to create tables (${res.status})`);
    }
    return res.json();
  },

  async listTables(menuSlug, includeInactive = false) {
    const params = new URLSearchParams({ menu_slug: menuSlug });
    if (includeInactive) params.set('include_inactive', 'true');
    const res = await fetch(`${API_BASE}/api/v1/tables?${params}`);
    if (!res.ok) throw new Error(`Failed to load tables (${res.status})`);
    return res.json();
  },

  async deleteTable(tableId) {
    const res = await fetch(`${API_BASE}/api/v1/tables/${tableId}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Delete failed (${res.status})`);
    }
  },

  async downloadTableQrPdf(menuSlug, restaurantName = 'Restaurant', qrSettings = {}) {
    const { fillColor = 'black', backColor = 'white', showLogo = false } = qrSettings;
    const params = new URLSearchParams({
      menu_slug: menuSlug,
      restaurant_name: restaurantName,
      fill_color: fillColor,
      back_color: backColor,
      logo: showLogo ? 'true' : 'false',
    });
    const res = await fetch(`${API_BASE}/api/v1/tables/export/qr-pdf?${params}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Export failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qrcodes-${menuSlug}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async getDashboardMenus() {
    const res = await fetch(`${API_BASE}/api/dashboard/menus`);
    if (!res.ok) throw new Error('Failed to load menus');
    return res.json();
  },

  // Admin backoffice
  async getAdminStats() {
    const res = await fetch(`${API_BASE}/api/v1/admin/stats`);
    if (!res.ok) throw new Error('Failed to load admin stats');
    return res.json();
  },

  async getAdminRestaurants(params = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    const res = await fetch(`${API_BASE}/api/v1/admin/restaurants${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw new Error('Failed to load restaurants');
    return res.json();
  },

  async patchAdminRestaurantStatus(slug, status) {
    const res = await fetch(`${API_BASE}/api/v1/admin/restaurants/${slug}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error('Failed to update restaurant status');
    return res.json();
  },

  async getAdminSubscriptions(params = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    const res = await fetch(`${API_BASE}/api/v1/admin/subscriptions${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw new Error('Failed to load subscriptions');
    return res.json();
  },

  async getAdminAuditLogs({ action, resource_type, resource_id, limit = 50, offset = 0 } = {}) {
    const params = new URLSearchParams();
    if (action) params.set('action', action);
    if (resource_type) params.set('resource_type', resource_type);
    if (resource_id) params.set('resource_id', resource_id);
    params.set('limit', limit);
    params.set('offset', offset);
    const res = await fetch(`${API_BASE}/api/v1/admin/audit-logs?${params}`);
    if (!res.ok) throw new Error('Failed to load audit logs');
    return res.json();
  },

  async getDashboardConversations(slug) {
    const res = await fetch(`${API_BASE}/api/dashboard/menus/${slug}/conversations`);
    if (!res.ok) throw new Error('Failed to load conversations');
    return res.json();
  },

  // Subscriptions
  async getSubscription(restaurantId) {
    const res = await fetch(`${API_BASE}/api/v1/subscriptions/${encodeURIComponent(restaurantId)}`);
    if (!res.ok) throw new Error('Failed to load subscription');
    return res.json();
  },

  async createSubscriptionCheckout(restaurantId, customerEmail = '') {
    const res = await fetch(`${API_BASE}/api/v1/subscriptions/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurant_id: restaurantId, customer_email: customerEmail }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Checkout failed');
    }
    return res.json();
  },

  async createSubscriptionPortal(restaurantId) {
    const res = await fetch(`${API_BASE}/api/v1/subscriptions/portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurant_id: restaurantId }),
    });
    if (!res.ok) throw new Error('Failed to create portal session');
    return res.json();
  },

  async getReviewAnalytics(slug) {
    const res = await fetch(`${API_BASE}/api/dashboard/menus/${slug}/analytics/reviews`);
    if (!res.ok) throw new Error('Failed to load review analytics');
    return res.json();
  },

  async getAnalyticsSummary(slug, period = '7d') {
    const res = await fetch(`${API_BASE}/api/v1/analytics/summary?slug=${encodeURIComponent(slug)}&period=${period}`);
    if (!res.ok) throw new Error('Failed to load analytics summary');
    return res.json();
  },

  async getAnalyticsRevenue(slug, period = '7d') {
    const res = await fetch(`${API_BASE}/api/v1/analytics/revenue?slug=${encodeURIComponent(slug)}&period=${period}`);
    if (!res.ok) throw new Error('Failed to load revenue analytics');
    return res.json();
  },

  async getAnalyticsChatbot(slug, period = '7d') {
    const res = await fetch(`${API_BASE}/api/v1/analytics/chatbot?slug=${encodeURIComponent(slug)}&period=${period}`);
    if (!res.ok) throw new Error('Failed to load chatbot analytics');
    return res.json();
  },

  async getAnalyticsItems(slug, period = '7d') {
    const res = await fetch(`${API_BASE}/api/v1/analytics/items?slug=${encodeURIComponent(slug)}&period=${period}`);
    if (!res.ok) throw new Error('Failed to load items analytics');
    return res.json();
  },

  async getAnalyticsCovers(slug, period = '7d') {
    const res = await fetch(`${API_BASE}/api/v1/analytics/covers?slug=${encodeURIComponent(slug)}&period=${period}`);
    if (!res.ok) throw new Error('Failed to load covers analytics');
    return res.json();
  },

  async exportAnalyticsCsv(slug, from, to) {
    const params = new URLSearchParams({ slug, from_date: from, to_date: to, format: 'csv' });
    const res = await fetch(`${API_BASE}/api/v1/analytics/export?${params}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Export failed (${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-${slug}-${from}-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // Restaurant profile
  async getRestaurantProfile(slug) {
    const res = await fetch(`${API_BASE}/api/v1/restaurants/${slug}`);
    if (!res.ok) throw new Error(`Failed to load profile (${res.status})`);
    return res.json();
  },

  async updateRestaurantProfile(slug, body) {
    const res = await fetch(`${API_BASE}/api/v1/restaurants/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Update failed (${res.status})`);
    }
    return res.json();
  },

  async uploadRestaurantLogo(slug, file) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/api/v1/restaurants/${slug}/logo`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Logo upload failed (${res.status})`);
    }
    return res.json(); // { logo_url }
  },

  // Stripe payments
  async getStripeConfig() {
    const res = await fetch(`${API_BASE}/api/v1/payments/config`);
    if (!res.ok) throw new Error('Failed to load Stripe config');
    return res.json(); // { publishable_key }
  },

  async createPaymentIntent(slug, items, tipAmount = 0, currency = 'eur', tableToken = null, splitPersons = 1, splitIndex = 1) {
    const res = await fetch(`${API_BASE}/api/v1/payments/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        items,
        tip_amount: tipAmount,
        currency,
        table_token: tableToken,
        split_persons: splitPersons,
        split_index: splitIndex,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Payment intent failed (${res.status})`);
    }
    return res.json(); // { client_secret, payment_intent_id, amount, currency, split_total, split_persons }
  },

  // Waiter call
  async callWaiter(slug, tableToken, message = 'Appel serveur') {
    const res = await fetch(`${API_BASE}/api/public/menus/${slug}/call-waiter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table_token: tableToken, message }),
    });
    if (!res.ok) throw new Error('Call waiter failed');
    return res.json();
  },

  async getWaiterCalls(slug) {
    const res = await fetch(`${API_BASE}/api/dashboard/menus/${slug}/waiter-calls`);
    if (!res.ok) throw new Error('Failed to get waiter calls');
    return res.json();
  },

  async dismissWaiterCall(slug, callId) {
    await fetch(`${API_BASE}/api/dashboard/menus/${slug}/waiter-calls/${callId}`, {
      method: 'DELETE',
    });
  },

  async submitFeedback({ slug, nps_score, comment, payment_intent_id, lang }) {
    const res = await fetch(`${API_BASE}/api/public/menus/${slug}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, nps_score, comment, payment_intent_id, lang }),
    });
    if (!res.ok) throw new Error('Feedback submission failed');
    return res.json();
  },

  // Admin backoffice
  async adminStats(token) {
    const res = await fetch(`${API_BASE}/api/v1/admin/stats`, {
      headers: { 'X-Admin-Token': token },
    });
    if (!res.ok) throw new Error(`Admin stats failed (${res.status})`);
    return res.json();
  },

  async adminRestaurants(token, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${API_BASE}/api/v1/admin/restaurants${qs ? `?${qs}` : ''}`, {
      headers: { 'X-Admin-Token': token },
    });
    if (!res.ok) throw new Error(`Admin restaurants failed (${res.status})`);
    return res.json();
  },

  async adminSubscriptions(token, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${API_BASE}/api/v1/admin/subscriptions${qs ? `?${qs}` : ''}`, {
      headers: { 'X-Admin-Token': token },
    });
    if (!res.ok) throw new Error(`Admin subscriptions failed (${res.status})`);
    return res.json();
  },

  async adminAuditLogs(token, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${API_BASE}/api/v1/admin/audit-logs${qs ? `?${qs}` : ''}`, {
      headers: { 'X-Admin-Token': token },
    });
    if (!res.ok) throw new Error(`Admin audit logs failed (${res.status})`);
    return res.json();
  },

  // Generic helpers used by TranslatorPage and others
  async get(url) {
    const res = await fetch(`${API_BASE}${url}`);
    if (!res.ok) throw new Error(`GET ${url} failed (${res.status})`);
    return { data: await res.json() };
  },

  async patch(url, body) {
    const res = await fetch(`${API_BASE}${url}`, {
      method: 'PATCH',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `PATCH ${url} failed (${res.status})`);
    }
    return { data: await res.json() };
  },
};
