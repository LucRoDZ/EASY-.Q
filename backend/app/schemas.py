from pydantic import BaseModel, field_validator
from typing import Optional

# ---------------------------------------------------------------------------
# OCR output validation schemas
# ---------------------------------------------------------------------------

VALID_ALLERGENS = {
    "gluten", "lactose", "oeufs", "poisson", "arachides", "soja",
    "fruits_coque", "celeri", "moutarde", "sesame", "sulfites",
    "lupin", "mollusques", "crustaces",
}

VALID_TAGS = {
    "meat", "fish", "vegetarian", "vegan", "spicy", "dessert",
    "starter", "cheese", "halal", "bio", "maison", "signature", "nouveau",
}

VALID_WINE_TYPES = {"red", "white", "rose", "sparkling"}


class OCRMenuItem(BaseModel):
    name: str
    description: Optional[str] = None
    price: Optional[float] = None
    allergens: list[str] = []
    tags: list[str] = []

    @field_validator("allergens")
    @classmethod
    def validate_allergens(cls, v: list[str]) -> list[str]:
        return [a for a in v if a in VALID_ALLERGENS]

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v: list[str]) -> list[str]:
        return [t for t in v if t in VALID_TAGS]

    @field_validator("price")
    @classmethod
    def validate_price(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and v < 0:
            return None
        return v


class OCRMenuSection(BaseModel):
    title: str
    items: list[OCRMenuItem] = []


class OCRWine(BaseModel):
    name: str
    type: Optional[str] = None
    price: Optional[float] = None
    pairing_tags: list[str] = []

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_WINE_TYPES:
            return None
        return v


class OCRMenuData(BaseModel):
    restaurant_name: str = "Unknown"
    currency: str = "EUR"
    sections: list[OCRMenuSection] = []
    wines: list[OCRWine] = []


class MenuCreateResponse(BaseModel):
    id: int
    slug: str
    public_url: str
    qr_url: str


class MenuItem(BaseModel):
    name: str
    description: Optional[str] = None
    price: Optional[float] = None
    tags: list[str] = []


class MenuSection(BaseModel):
    title: str
    items: list[MenuItem] = []


class Wine(BaseModel):
    name: str
    type: Optional[str] = None
    region: Optional[str] = None
    grape: Optional[str] = None
    price: Optional[float] = None
    pairing_tags: list[str] = []


class MenuData(BaseModel):
    restaurant_name: str
    currency: Optional[str] = "EUR"
    sections: list[MenuSection] = []
    wines: list[Wine] = []


class PublicMenuResponse(BaseModel):
    restaurant_name: str
    lang: str
    available_languages: list[str]
    currency: Optional[str] = None
    sections: list[dict] = []
    wines: list[dict] = []


class ChatRequest(BaseModel):
    messages: list[dict]
    lang: str = "en"
    session_id: str | None = None  # For conversation memory


class ChatResponse(BaseModel):
    answer: str


class ConversationResponse(BaseModel):
    messages: list[dict]


class UploadMenuResponse(BaseModel):
    menu_id: int
    slug: str
    status: str  # "processing" | "ready" | "error"


class MenuStatusResponse(BaseModel):
    menu_id: int
    slug: str
    status: str
    ocr_error: Optional[str] = None
    menu_data: Optional[dict] = None


# ---------------------------------------------------------------------------
# Menu editor schemas
# ---------------------------------------------------------------------------

class MenuItemUpdate(BaseModel):
    name: str
    description: Optional[str] = None
    price: Optional[float] = None
    allergens: list[str] = []
    tags: list[str] = []
    is_available: bool = True


class MenuSectionUpdate(BaseModel):
    title: str
    items: list[MenuItemUpdate] = []


class MenuUpdateBody(BaseModel):
    restaurant_name: Optional[str] = None
    sections: Optional[list[MenuSectionUpdate]] = None
    wines: Optional[list[dict]] = None


class MenuEditorResponse(BaseModel):
    menu_id: int
    slug: str
    restaurant_name: str
    status: str
    publish_status: str = "draft"
    sections: list[dict] = []
    wines: list[dict] = []
    languages: str


class MenuSaveResponse(BaseModel):
    menu_id: int
    slug: str
    status: str = "ok"


class MenuPublishResponse(BaseModel):
    menu_id: int
    slug: str
    publish_status: str


class MenuDuplicateResponse(BaseModel):
    menu_id: int
    slug: str


# ---------------------------------------------------------------------------
# Tables / QR schemas
# ---------------------------------------------------------------------------

class TableCreateBulk(BaseModel):
    menu_slug: str
    restaurant_id: str = "default"
    count: int
    prefix: str = "Table"
    start_at: int = 1
    zone: Optional[str] = None   # becomes the label


class TableUpdateBody(BaseModel):
    number: Optional[str] = None
    label: Optional[str] = None
    capacity: Optional[int] = None
    is_active: Optional[bool] = None
    status: Optional[str] = None  # available, occupied, reserved


class TableResponse(BaseModel):
    id: int
    menu_slug: str
    number: str
    label: Optional[str] = None
    capacity: int
    qr_token: str
    qr_url: str        # backend URL to GET the QR image
    is_active: bool
    status: str = "available"


# ---------------------------------------------------------------------------
# Translation schemas
# ---------------------------------------------------------------------------

class TranslateResponse(BaseModel):
    menu_id: int
    lang: str
    sections: list[dict] = []
    wines: list[dict] = []


class SaveTranslationBody(BaseModel):
    sections: list[dict] = []
    wines: list[dict] = []


class BulkTranslateResponse(BaseModel):
    menu_id: int
    languages: list[str]
    errors: dict[str, str] = {}


# ---------------------------------------------------------------------------
# Restaurant profile schemas
# ---------------------------------------------------------------------------

class DayHours(BaseModel):
    open: Optional[str] = "09:00"
    close: Optional[str] = "22:00"
    closed: bool = False


class RestaurantProfileUpdate(BaseModel):
    name: Optional[str] = None
    logo_url: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    opening_hours: Optional[dict] = None  # {day: DayHours}
    timezone: Optional[str] = None
    social_links: Optional[dict] = None   # {instagram, facebook, google_maps}


class RestaurantProfileResponse(BaseModel):
    slug: str
    name: str
    logo_url: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    opening_hours: Optional[dict] = None
    timezone: Optional[str] = None
    social_links: Optional[dict] = None


class LogoUploadResponse(BaseModel):
    logo_url: str


# ---------------------------------------------------------------------------
# Waiter call schemas
# ---------------------------------------------------------------------------

class WaiterCallRequest(BaseModel):
    table_token: str
    message: str = "Appel serveur"


# ---------------------------------------------------------------------------
# Feedback / NPS schemas
# ---------------------------------------------------------------------------

class FeedbackRequest(BaseModel):
    slug: str
    nps_score: int              # 1–10
    comment: Optional[str] = None
    payment_intent_id: Optional[str] = None
    lang: str = "fr"


# ---------------------------------------------------------------------------
# Payment schemas
# ---------------------------------------------------------------------------

class CartItem(BaseModel):
    name: str
    price: float
    quantity: int = 1


class CreatePaymentIntentRequest(BaseModel):
    slug: str
    items: list[CartItem]
    tip_amount: float = 0.0        # in euros
    currency: str = "eur"
    table_token: Optional[str] = None


class PaymentIntentResponse(BaseModel):
    client_secret: str
    payment_intent_id: str
    amount: int                    # total in cents
    currency: str


# ---------------------------------------------------------------------------
# Order schemas
# ---------------------------------------------------------------------------

class OrderItemCreate(BaseModel):
    name: str
    price: float    # euros
    quantity: int = 1


class OrderCreate(BaseModel):
    menu_slug: str
    table_token: Optional[str] = None
    items: list[OrderItemCreate]
    currency: str = "eur"
    notes: Optional[str] = None

    @field_validator("items")
    @classmethod
    def validate_items_not_empty(cls, v: list) -> list:
        if not v:
            raise ValueError("Order must contain at least one item")
        return v


class OrderResponse(BaseModel):
    id: int
    menu_slug: str
    table_token: Optional[str] = None
    items: list[dict]
    total: int          # cents
    currency: str
    status: str
    notes: Optional[str] = None
    created_at: str

    class Config:
        from_attributes = True
