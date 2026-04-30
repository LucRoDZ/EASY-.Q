export const translations = {
  en: {
    // Header
    menu: "Menu",
    cart: "Cart",
    
    // Menu page
    askAboutMenu: "Ask about the menu...",
    thinking: "Thinking...",
    
    // Cart page
    yourCart: "Your Cart",
    emptyCart: "Your cart is empty",
    browseMenu: "Browse Menu",
    item: "item",
    items: "items",
    total: "Total",
    pay: "Pay",
    remove: "Remove",
    acceptedPayments: "Accepted payment methods",
    
    // Chat
    welcomeMessage: "Hello! I'm your virtual waiter. How can I help you choose your meal today?",
    chatError: "Sorry, I had trouble responding. Please try again.",
    "chat.welcome": "Hello! I'm your virtual waiter. How can I help you choose your meal today?",
    "chat.error": "Sorry, I had trouble responding. Please try again.",
    "chat.errorQuota": "The AI assistant is temporarily busy (quota reached). Please try again in a minute.",
    "chat.title": "Assistant",
    "chat.thinking": "Thinking...",
    "chat.placeholder": "Ask about the menu...",
    "chat.newConversation": "Erase conversation",
    
    // Menu sections
    toShare: "To Share",
    starters: "Starters",
    salads: "Salads",
    exceptional: "Exceptional Pieces",
    sides: "Sides",
    vegetables: "Vegetables",
    meats: "Meats",
    fish: "Fish",
    desserts: "Desserts",
    
    // Actions
    addToCart: "Add",
    added: "Added!",

    // Waiter call
    "waiter.callButton": "Call waiter",
    "waiter.callSent": "Waiter called!",
    "waiter.callError": "Error, try again",
  },
  
  fr: {
    // Header
    menu: "Menu",
    cart: "Panier",
    
    // Menu page
    askAboutMenu: "Posez une question sur le menu...",
    thinking: "Réflexion...",
    
    // Cart page
    yourCart: "Votre Panier",
    emptyCart: "Votre panier est vide",
    browseMenu: "Voir le Menu",
    item: "article",
    items: "articles",
    total: "Total",
    pay: "Payer",
    remove: "Supprimer",
    acceptedPayments: "Modes de paiement acceptés",
    
    // Chat
    welcomeMessage: "Bonjour! Je suis votre serveur virtuel. Comment puis-je vous aider à choisir votre repas?",
    chatError: "Désolé, je n'ai pas pu répondre. Veuillez réessayer.",
    "chat.welcome": "Bonjour! Je suis votre serveur virtuel. Comment puis-je vous aider à choisir votre repas?",
    "chat.error": "Désolé, je n'ai pas pu répondre. Veuillez réessayer.",
    "chat.errorQuota": "L'assistant IA est temporairement indisponible (quota atteint). Réessayez dans une minute.",
    "chat.title": "Assistant",
    "chat.thinking": "Réflexion...",
    "chat.placeholder": "Posez une question sur le menu...",
    "chat.newConversation": "Effacer la conversation",
    
    // Menu sections
    toShare: "À Partager",
    starters: "Entrées",
    salads: "Salades",
    exceptional: "Pièces d'Exception",
    sides: "Garnitures",
    vegetables: "Végétaux",
    meats: "Viandes",
    fish: "Poissons",
    desserts: "Desserts",
    
    // Actions
    addToCart: "Ajouter",
    added: "Ajouté!",

    // Waiter call
    "waiter.callButton": "Appel serveur",
    "waiter.callSent": "Serveur appelé !",
    "waiter.callError": "Erreur, réessayez",
  },
  
  es: {
    // Header
    menu: "Menú",
    cart: "Carrito",
    
    // Menu page
    askAboutMenu: "Pregunta sobre el menú...",
    thinking: "Pensando...",
    
    // Cart page
    yourCart: "Tu Carrito",
    emptyCart: "Tu carrito está vacío",
    browseMenu: "Ver Menú",
    item: "artículo",
    items: "artículos",
    total: "Total",
    pay: "Pagar",
    remove: "Eliminar",
    acceptedPayments: "Métodos de pago aceptados",
    
    // Chat
    welcomeMessage: "¡Hola! Soy su camarero virtual. ¿Cómo puedo ayudarle a elegir su comida hoy?",
    chatError: "Lo siento, tuve problemas para responder. Por favor, inténtelo de nuevo.",
    "chat.welcome": "¡Hola! Soy su camarero virtual. ¿Cómo puedo ayudarle a elegir su comida hoy?",
    "chat.error": "Lo siento, tuve problemas para responder. Por favor, inténtelo de nuevo.",
    "chat.errorQuota": "El asistente de IA está temporalmente no disponible (cuota alcanzada). Inténtelo de nuevo en un minuto.",
    "chat.title": "Asistente",
    "chat.thinking": "Pensando...",
    "chat.placeholder": "Pregunta sobre el menú...",
    "chat.newConversation": "Borrar conversación",
    
    // Menu sections
    toShare: "Para Compartir",
    starters: "Entrantes",
    salads: "Ensaladas",
    exceptional: "Piezas Excepcionales",
    sides: "Guarniciones",
    vegetables: "Vegetales",
    meats: "Carnes",
    fish: "Pescados",
    desserts: "Postres",
    
    // Actions
    addToCart: "Añadir",
    added: "¡Añadido!",

    // Waiter call
    "waiter.callButton": "Llamar al camarero",
    "waiter.callSent": "¡Camarero llamado!",
    "waiter.callError": "Error, inténtelo de nuevo",
  }
};

export function t(lang, key) {
  return translations[lang]?.[key] || translations.en[key] || key;
}
