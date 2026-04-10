import { createContext, useContext, useState, useEffect, useRef } from 'react';

const CartContext = createContext();

const STORAGE_KEY = 'easyq_cart';
const CHANNEL_NAME = 'easyq-cart';

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
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
      if (event.data?.type === 'CART_UPDATE') {
        suppressRef.current = true;
        setItems(event.data.items ?? []);
        suppressRef.current = false;
      }
    };

    return () => ch.close();
  }, []);

  // Persist to localStorage and broadcast on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    if (channelRef.current && !suppressRef.current) {
      channelRef.current.postMessage({ type: 'CART_UPDATE', items });
    }
  }, [items]);

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
      value={{ items, addItem, removeItem, updateQuantity, clearCart, total, itemCount }}
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
