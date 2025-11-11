// server/index.js
import express from "express";
import cors from "cors";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 8000;

// --- middleware ---
app.use(cors());
app.use(express.json());

// --- sample product data ---
const products = [
  { id: "s-201", name: "A4 Bond Paper (500s)", price: 180, image: "bondpaper.jpg" },
  { id: "s-202", name: "Yellow Pad (80 leaves)", price: 45, image: "yellowpad.jpg" },
  { id: "s-203", name: "UniThrift Tote Bag", price: 150, image: "totebag.jpg" },
  { id: "s-204", name: "Refillable Notebook", price: 120, image: "notebook.jpg" },
];

// --- API: Get all products ---
app.get("/api/products", (_req, res) => {
  res.json(products);
});

// --- friendly GET for checkout ---
app.get("/api/cart/checkout", (_req, res) => {
  res
    .status(405)
    .send("Use POST /api/cart/checkout to place an order (with JSON body).");
});

// --- POST: Checkout + Save order ---
app.post("/api/cart/checkout", (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const total = items.reduce((sum, i) => sum + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);

  const orderId = "ord_" + Math.random().toString(36).slice(2, 8);
  const pickup = { etaMins: 15, fee: 0 };
  const orderData = { orderId, total, pickup, items, date: new Date().toISOString() };

  // Read old orders
  let orders = [];
  try {
    if (fs.existsSync("orders.json")) {
      orders = JSON.parse(fs.readFileSync("orders.json", "utf8"));
    }
  } catch (err) {
    console.error("Error reading orders file:", err);
  }

  // Save new order
  orders.push(orderData);
  fs.writeFileSync("orders.json", JSON.stringify(orders, null, 2));

  console.log(`✅ Saved order ${orderId}`);
  res.json(orderData);
});

// --- API: View all orders (for testing) ---
app.get("/api/orders", (_req, res) => {
  try {
    if (!fs.existsSync("orders.json")) return res.json([]);
    const data = JSON.parse(fs.readFileSync("orders.json", "utf8"));
    res.json(data);
  } catch (err) {
    console.error("Error reading orders:", err);
    res.status(500).json({ error: "Failed to read orders." });
  }
});

app.listen(PORT, () => {
  console.log(`UniThrift backend running at http://localhost:${PORT}`);
});
