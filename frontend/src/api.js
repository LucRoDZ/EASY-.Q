const API_BASE = import.meta.env.VITE_API_URL || '';

// Normalise FastAPI error details (string or {code, message, upgrade_url} objects)
function apiDetail(err, fallback) {
  const d = err?.detail;
  if (typeof d === 'string') return d;
  if (d && typeof d === 'object' && d.message) return d.message;
  return fallback;
}


// Generate or get session ID for conversation memory
function getSessionId() {
  let sessionId = localStorage.getItem('chat_session_id');
  if (!sessionId) {
    sessionId = 'session_' + crypto.randomUUID().replace(/-/g, '');
    localStorage.setItem('chat_session_id', sessionId);
  }
  return sessionId;
}

export const api = {
  getSessionId,
  
  async getMenu(slug, lang = 'en') {
    const res = await fetch(`${API_BASE}/api/public/menus/${slug}?lang=${lang}`, { cache: 'no-store' });
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

  async uploadMenu(restaurantName, pdfFile, token, languages = 'en,fr,es') {
    const formData = new FormData();
    formData.append('restaurant_name', restaurantName);
    formData.append('languages', languages);
    formData.append('pdf', pdfFile);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(`${API_BASE}/api/menus`, {
      method: 'POST',
      headers,
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
  async uploadMenuAsync(restaurantName, file, token) {
    const formData = new FormData();
    formData.append('restaurant_name', restaurantName);
    formData.append('file', file);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(`${API_BASE}/api/v1/menus/upload`, {
      method: 'POST',
      headers,
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
  async getMenuStatus(menuId, token) {
    const res = await fetch(`${API_BASE}/api/v1/menus/${menuId}/status`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Status check failed (${res.status})`);
    return res.json();
  },

  // Editor: load full menu data
  async getMenuById(menuId, token) {
    const res = await fetch(`${API_BASE}/api/v1/menus/${menuId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Menu not found (${res.status})`);
    return res.json();
  },

  // Editor: save sections/wines
  async updateMenu(menuId, body, token) {
    const res = await fetch(`${API_BASE}/api/v1/menus/${menuId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiDetail(err, `Save failed (${res.status})`));
    }
    return res.json();
  },

  // Editor: toggle publish status ('draft' | 'published')
  async publishMenu(menuId, publishStatus, token) {
    const params = new URLSearchParams({ publish_status: publishStatus });
    const res = await fetch(`${API_BASE}/api/v1/menus/${menuId}/publish?${params}`, {
      method: 'PATCH',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiDetail(err, `Publish failed (${res.status})`));
    }
    return res.json();
  },

  // Editor: duplicate a menu — returns { menu_id, slug }
  async duplicateMenu(menuId, token) {
    const res = await fetch(`${API_BASE}/api/v1/menus/${menuId}/duplicate`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiDetail(err, `Duplicate failed (${res.status})`));
    }
    return res.json();
  },

  // Editor: upload item photo
  async uploadItemImage(menuId, sectionIndex, itemIndex, file, token) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(
      `${API_BASE}/api/v1/menus/${menuId}/items/${sectionIndex}/${itemIndex}/image`,
      {
        method: 'PATCH',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiDetail(err, `Image upload failed (${res.status})`));
    }
    return res.json();
  },

  // Tables
  async createTablesBulk(body, token) {
    const res = await fetch(`${API_BASE}/api/v1/tables/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiDetail(err, `Failed to create tables (${res.status})`));
    }
    return res.json();
  },

  async listTables(menuSlug, includeInactive = false, token) {
    const params = new URLSearchParams({ menu_slug: menuSlug });
    if (includeInactive) params.set('include_inactive', 'true');
    const res = await fetch(`${API_BASE}/api/v1/tables?${params}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Failed to load tables (${res.status})`);
    return res.json();
  },

  async deleteTable(tableId, token) {
    const res = await fetch(`${API_BASE}/api/v1/tables/${tableId}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiDetail(err, `Delete failed (${res.status})`));
    }
  },

  async downloadTableQrPdf(menuSlug, restaurantName = 'Restaurant', qrSettings = {}, token) {
    const { fillColor = 'black', backColor = 'white', showLogo = false } = qrSettings;
    const params = new URLSearchParams({
      menu_slug: menuSlug,
      restaurant_name: restaurantName,
      fill_color: fillColor,
      back_color: backColor,
      logo: showLogo ? 'true' : 'false',
    });
    const res = await fetch(`${API_BASE}/api/v1/tables/export/qr-pdf?${params}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiDetail(err, 'Export failed'));
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qrcodes-${menuSlug}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async getCurrentUser(token) {
    const res = await fetch(`${API_BASE}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to fetch user');
    return res.json();
  },

  async getDashboardMenus(token) {
    const res = await fetch(`${API_BASE}/api/dashboard/menus`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Failed to load menus');
    return res.json();
  },

  // Admin backoffice — all methods require a Clerk Bearer token
  async getAdminStats(token) {
    const res = await fetch(`${API_BASE}/api/v1/admin/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to load admin stats');
    return res.json();
  },

  async getAdminRestaurants(token, params = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    const res = await fetch(`${API_BASE}/api/v1/admin/restaurants${qs ? `?${qs}` : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to load restaurants');
    return res.json();
  },

  async patchAdminRestaurantStatus(slug, status, token) {
    const res = await fetch(`${API_BASE}/api/v1/admin/restaurants/${slug}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error('Failed to update restaurant status');
    return res.json();
  },

  async getAdminSubscriptions(token, params = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    const res = await fetch(`${API_BASE}/api/v1/admin/subscriptions${qs ? `?${qs}` : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to load subscriptions');
    return res.json();
  },

  async getAdminAuditLogs(token, { action, resource_type, resource_id, limit = 50, offset = 0 } = {}) {
    const params = new URLSearchParams();
    if (action) params.set('action', action);
    if (resource_type) params.set('resource_type', resource_type);
    if (resource_id) params.set('resource_id', resource_id);
    params.set('limit', limit);
    params.set('offset', offset);
    const res = await fetch(`${API_BASE}/api/v1/admin/audit-logs?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to load audit logs');
    return res.json();
  },

  async getDashboardConversations(slug, token) {
    const res = await fetch(`${API_BASE}/api/dashboard/menus/${slug}/conversations`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Failed to load conversations');
    return res.json();
  },

  // Subscriptions
  async getSubscription(restaurantId, token) {
    const res = await fetch(`${API_BASE}/api/v1/subscriptions/${encodeURIComponent(restaurantId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Failed to load subscription');
    return res.json();
  },

  async createSubscriptionCheckout(restaurantId, customerEmail = '', token) {
    const res = await fetch(`${API_BASE}/api/v1/subscriptions/create-checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ restaurant_id: restaurantId, customer_email: customerEmail }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiDetail(err, 'Checkout failed'));
    }
    return res.json();
  },

  async createSubscriptionPortal(restaurantId, token) {
    const res = await fetch(`${API_BASE}/api/v1/subscriptions/portal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ restaurant_id: restaurantId }),
    });
    if (!res.ok) throw new Error('Failed to create portal session');
    return res.json();
  },

  async getReviewAnalytics(slug, token) {
    const res = await fetch(`${API_BASE}/api/dashboard/menus/${slug}/analytics/reviews`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Failed to load review analytics');
    return res.json();
  },

  async getAnalyticsSummary(slug, period = '7d', token) {
    const res = await fetch(`${API_BASE}/api/v1/analytics/summary?slug=${encodeURIComponent(slug)}&period=${period}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Failed to load analytics summary');
    return res.json();
  },

  async getAnalyticsRevenue(slug, period = '7d', token) {
    const res = await fetch(`${API_BASE}/api/v1/analytics/revenue?slug=${encodeURIComponent(slug)}&period=${period}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Failed to load revenue analytics');
    return res.json();
  },

  async getAnalyticsChatbot(slug, period = '7d', token) {
    const res = await fetch(`${API_BASE}/api/v1/analytics/chatbot?slug=${encodeURIComponent(slug)}&period=${period}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Failed to load chatbot analytics');
    return res.json();
  },

  async getAnalyticsItems(slug, period = '7d', token) {
    const res = await fetch(`${API_BASE}/api/v1/analytics/items?slug=${encodeURIComponent(slug)}&period=${period}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Failed to load items analytics');
    return res.json();
  },

  async getAnalyticsCovers(slug, period = '7d', token) {
    const res = await fetch(`${API_BASE}/api/v1/analytics/covers?slug=${encodeURIComponent(slug)}&period=${period}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Failed to load covers analytics');
    return res.json();
  },

  async exportAnalyticsCsv(slug, from, to, token) {
    const params = new URLSearchParams({ slug, from_date: from, to_date: to, format: 'csv' });
    const res = await fetch(`${API_BASE}/api/v1/analytics/export?${params}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiDetail(err, `Export failed (${res.status})`));
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-${slug}-${from}-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async createOrder(body) {
    const res = await fetch(`${API_BASE}/api/v1/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiDetail(err, `Order failed (${res.status})`));
    }
    return res.json();
  },

  async getOrder(orderId) {
    const res = await fetch(`${API_BASE}/api/v1/orders/${orderId}`);
    if (!res.ok) return null;
    return res.json();
  },

  async getGoogleRating(slug) {
    const res = await fetch(`${API_BASE}/api/v1/restaurants/${slug}/google-rating`);
    if (!res.ok) return null;
    return res.json();
  },

  async getKdsToken(slug, token) {
    const res = await fetch(`${API_BASE}/api/v1/kds/${slug}/token`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`KDS token fetch failed (${res.status})`);
    return res.json(); // { token: "..." }
  },

  async updateKdsOrderStatus(slug, orderId, status, token) {
    const res = await fetch(
      `${API_BASE}/api/v1/kds/${slug}/orders/${orderId}/status`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status }),
      }
    );
    if (!res.ok) throw new Error(`KDS status update failed (${res.status})`);
    return res.json();
  },

  async setItemAvailability(slug, itemName, available, token) {
    const res = await fetch(`${API_BASE}/api/v1/kds/${slug}/items/availability`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ item_name: itemName, available }),
    });
    if (!res.ok) throw new Error(`Availability update failed (${res.status})`);
    return res.json();
  },

  async completeOnboarding(body, token) {
    const res = await fetch(`${API_BASE}/api/v1/restaurants/onboarding/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Onboarding failed (${res.status})`);
    return res.json();
  },

  // Restaurant profile
  async getRestaurantProfile(slug) {
    const res = await fetch(`${API_BASE}/api/v1/restaurants/${slug}`);
    if (!res.ok) throw new Error(`Failed to load profile (${res.status})`);
    return res.json();
  },

  async updateRestaurantProfile(slug, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/api/v1/restaurants/${slug}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiDetail(err, `Update failed (${res.status})`));
    }
    return res.json();
  },

  async uploadRestaurantLogo(slug, file, token) {
    const formData = new FormData();
    formData.append('file', file);
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/api/v1/restaurants/${slug}/logo`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiDetail(err, `Logo upload failed (${res.status})`));
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
      throw new Error(apiDetail(err, `Payment intent failed (${res.status})`));
    }
    return res.json(); // { client_secret, payment_intent_id, amount, currency, order_id, split_total, split_persons }
  },

  // Reservations
  async createReservation(slug, body) {
    const res = await fetch(`${API_BASE}/api/v1/reservations/${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiDetail(err, `Reservation failed (${res.status})`));
    }
    return res.json();
  },

  async listReservations(slug, date, token) {
    const params = date ? `?date=${encodeURIComponent(date)}` : '';
    const res = await fetch(`${API_BASE}/api/v1/reservations/${slug}${params}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Failed to load reservations (${res.status})`);
    return res.json();
  },

  async updateReservation(slug, reservationId, status, token) {
    const res = await fetch(`${API_BASE}/api/v1/reservations/${slug}/${reservationId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error(`Failed to update reservation (${res.status})`);
    return res.json();
  },

  // Split bill
  async createSplitPayments(orderId, parts) {
    const res = await fetch(`${API_BASE}/api/v1/payments/split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, parts }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiDetail(err, `Split failed (${res.status})`));
    }
    return res.json();
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

  async getWaiterCalls(slug, token) {
    const res = await fetch(`${API_BASE}/api/dashboard/menus/${slug}/waiter-calls`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Failed to get waiter calls');
    return res.json();
  },

  async dismissWaiterCall(slug, callId, token) {
    await fetch(`${API_BASE}/api/dashboard/menus/${slug}/waiter-calls/${callId}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },

  async getLiveStats(slug, token) {
    const res = await fetch(`${API_BASE}/api/dashboard/menus/${slug}/live-stats`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Failed to load live stats (${res.status})`);
    return res.json();
  },

  // Staff management (owner)
  async listStaff(slug, token) {
    const res = await fetch(`${API_BASE}/api/v1/staff/${slug}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Failed to load staff (${res.status})`);
    return res.json();
  },

  async inviteStaff(slug, body, token) {
    const res = await fetch(`${API_BASE}/api/v1/staff/${slug}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiDetail(err, `Invitation failed (${res.status})`));
    }
    return res.json();
  },

  async updateStaff(slug, staffId, body, token) {
    const res = await fetch(`${API_BASE}/api/v1/staff/${slug}/${staffId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiDetail(err, `Update failed (${res.status})`));
    }
    return res.json();
  },

  async deactivateStaff(slug, staffId, token) {
    const res = await fetch(`${API_BASE}/api/v1/staff/${slug}/${staffId}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok && res.status !== 204) throw new Error(`Deactivation failed (${res.status})`);
  },

  // Stripe Connect (owner)
  async getConnectStatus(slug, token) {
    const res = await fetch(`${API_BASE}/api/v1/payments/connect/status?slug=${encodeURIComponent(slug)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiDetail(err, `Connect status failed (${res.status})`));
    }
    return res.json();
  },

  async startConnectOnboarding(slug, token) {
    const res = await fetch(`${API_BASE}/api/v1/payments/connect/onboard?slug=${encodeURIComponent(slug)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiDetail(err, `Connect onboarding failed (${res.status})`));
    }
    return res.json();
  },

  async updateWaiterCallStatus(slug, callId, status, token) {
    const res = await fetch(`${API_BASE}/api/dashboard/menus/${slug}/waiter-calls/${callId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error(`Failed to update call status (${res.status})`);
    return res.json();
  },

  async getTablesSummary(slug, token) {
    const res = await fetch(`${API_BASE}/api/dashboard/menus/${slug}/tables-summary`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Failed to load tables summary (${res.status})`);
    return res.json();
  },

  async listOrdersByTable(tableToken, token) {
    const res = await fetch(`${API_BASE}/api/v1/orders/by-table/${tableToken}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Failed to load table orders (${res.status})`);
    return res.json();
  },

  async updateTable(tableId, body, token) {
    const res = await fetch(`${API_BASE}/api/v1/tables/${tableId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiDetail(err, `Failed to update table (${res.status})`));
    }
    return res.json();
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
      throw new Error(apiDetail(err, `PATCH ${url} failed (${res.status})`));
    }
    return { data: await res.json() };
  },

  async post(url, body) {
    const res = await fetch(`${API_BASE}${url}`, {
      method: 'POST',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(apiDetail(err, `POST ${url} failed (${res.status})`));
    }
    return { data: await res.json() };
  },
};
