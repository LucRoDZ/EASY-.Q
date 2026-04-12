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

  async getDashboardConversations(slug) {
    const res = await fetch(`${API_BASE}/api/dashboard/menus/${slug}/conversations`);
    if (!res.ok) throw new Error('Failed to load conversations');
    return res.json();
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
