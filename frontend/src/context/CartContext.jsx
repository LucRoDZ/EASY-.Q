import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';

const CartContext = createContext();

const CHANNEL_NAME = 'easyq-cart';

function storageKey(slug) {
  return slug ? `easyq_cart_${slug}` : 'easyq_cart';
}

function tableTokenKey(slug) {
  return slug ? `easyq_table_token_${slug}` : 'easyq_table_token';
}

export function CartProvider({ children }) {
  const slugRef = useRef(null);
  const [items, setItems] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey(null));
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // BroadcastChannel for multi-tab sync
  const channelRef = useRef(null);
  const suppressRef = useRef(false); // prevent echo-loop when we broadcast

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;

    const ch = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = ch;

    ch.onmessage = (event) => {
      if (event.data?.type === 'CART_UPDATE' && event.data.slug === slugRef.current) {
        suppressRef.current = true;
        setItems(event.data.items ?? []);
        suppressRef.current = false;
      }
    };

    return () => ch.close();
  }, []);

  // Persist to localStorage and broadcast on change
  useEffect(() => {
    const key = storageKey(slugRef.current);
    localStorage.setItem(key, JSON.stringify(items));
    if (channelRef.current && !suppressRef.current) {
      channelRef.current.postMessage({ type: 'CART_UPDATE', slug: slugRef.current, items });
    }
  }, [items]);

  // Table QR token — persisted per restaurant so a page refresh or a
  // navigation that drops ?table=… doesn't lose the table context.
  const [tableToken, setTableTokenState] = useState('');

  const setTableToken = useCallback((token) => {
    setTableTokenState(token || '');
    try {
      const key = tableTokenKey(slugRef.current);
      if (token) localStorage.setItem(key, token);
      else localStorage.removeItem(key);
    } catch {
      // localStorage unavailable (private mode) — keep in-memory value only
    }
  }, []);

  // Called by menu/cart pages to scope the cart to the current restaurant
  const setSlug = useCallback((slug) => {
    if (slugRef.current === slug) return;
    slugRef.current = slug;
    try {
      const saved = localStorage.getItem(storageKey(slug));
      setItems(saved ? JSON.parse(saved) : []);
    } catch {
      setItems([]);
    }
    try {
      setTableTokenState(localStorage.getItem(tableTokenKey(slug)) || '');
    } catch {
      setTableTokenState('');
    }
  }, []);

  const addItem = (nameOrItem, priceArg) => {
    let name, price;
    if (typeof nameOrItem === 'object') {
      name = nameOrItem.name;
      price = nameOrItem.price;
    } else {
      name = nameOrItem;
      price = priceArg;
    }

    if (typeof price === 'string') {
      price = parseFloat(price.replace(/[^0-9.,]/g, '').replace(',', '.'));
    }
    if (isNaN(price) || price == null) {
      price = 0;
    }

    setItems((prev) => {
      const existing = prev.find((i) => i.name === name && i.price === price);
      if (existing) {
        return prev.map((i) =>
          i.name === name && i.price === price
            ? { ...i, quantity: i.quantity + 1 }
            : i
        );
      }
      return [...prev, { name, price, quantity: 1 }];
    });
  };

  const removeItem = (name, price) => {
    setItems((prev) => prev.filter((i) => !(i.name === name && i.price === price)));
  };

  const updateQuantity = (name, price, quantity) => {
    if (quantity <= 0) {
      removeItem(name, price);
      return;
    }
    setItems((prev) =>
      prev.map((i) =>
        i.name === name && i.price === price ? { ...i, quantity } : i
      )
    );
  };

  const clearCart = () => setItems([]);

  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <CartContext.Provider
      value={{ items, addItem, removeItem, updateQuantity, clearCart, total, itemCount, setSlug, tableToken, setTableToken }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within a CartProvider');
  return context;
}
