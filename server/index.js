// server/index.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { PrismaClient } from "@prisma/client";

const app = express();

// --- CORS (works with Safari/Chrome on any localhost port)
const corsOptions = {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);                 // curl / Postman
      if (/^http:\/\/localhost:\d+$/.test(origin)) return cb(null, true);
      return cb(null, false);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept", "Origin"], // allow common headers
  };
  app.use(cors(corsOptions));
  // generic preflight for Express v5
  app.use((req, res, next) => {
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use(express.json());
  

// (optional) tiny logger
app.use((req, _res, next) => {
  console.log(req.method, req.originalUrl);
  next();
});

const prisma = new PrismaClient();

// --- Health
app.get("/", (_req, res) => res.send("UniThrift API ✅"));

// --- Seed a few products
app.get("/api/seed", async (_req, res) => {
  const count = await prisma.product.count();
  if (count > 0) return res.json({ ok: true, count });
  await prisma.product.createMany({
    data: [
      { name: "GE Book: Ethics", price: 120, campus: "ADMU", category: "Books", imageUrl: "" },
      { name: "A4 Bond Paper (500s)", price: 180, campus: "ADMU", category: "School Supplies", imageUrl: "" },
      { name: "Preloved Hoodie", price: 130, campus: "ADMU", category: "Preloved", imageUrl: "" },
      { name: "Wired Earphones", price: 150, campus: "UPD", category: "Gadgets", imageUrl: "" },
    ],
  });
  res.json({ ok: true });
});

// --- Products
app.get("/api/products", async (req, res) => {
  const { campus, category, priceMin, priceMax } = req.query;
  const where = {};
  if (campus) where.campus = campus;
  if (category) where.category = category;
  if (priceMin || priceMax)
    where.price = {
      gte: priceMin ? Number(priceMin) : undefined,
      lte: priceMax ? Number(priceMax) : undefined,
    };
  const products = await prisma.product.findMany({ where, take: 60 });
  res.json(products);
});

// --- Estimate (OpenRouteService; falls back if no key/error)
const COORDS = {
  "SEC-A Lobby": [121.07793, 14.64068],
  "Gate 2.5": [121.07888, 14.6418],
  Regis: [121.07496, 14.63995],
  "Katipunan LRT": [121.07309, 14.63909],
  "AS Steps": [121.0647, 14.6547],
  "Shopping Center": [121.0657, 14.653],
  "Sunken Garden": [121.0644, 14.6536],
  "Main Gate": [120.989, 14.6096],
  "Quadricentennial Park": [120.9898, 14.6101],
  "Beato Library": [120.9904, 14.6092],
};

app.get("/api/estimate", async (req, res) => {
  try {
    const { from, to } = req.query;
    const start = COORDS[from];
    const end = COORDS[to];
    if (!start || !end) return res.status(400).json({ error: "Unknown pickup point" });

    // If you haven't set ORS_API_KEY yet, this will throw; we catch and fallback below.
    const r = await fetch("https://api.openrouteservice.org/v2/directions/foot-walking/geojson", {
      method: "POST",
      headers: {
        Authorization: process.env.ORS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ coordinates: [start, end] }),
    });
    if (!r.ok) throw new Error(`ORS ${r.status}`);
    const data = await r.json();
    const meters = data.features?.[0]?.properties?.summary?.distance ?? 500;
    const minutes = Math.ceil((data.features?.[0]?.properties?.summary?.duration ?? 600) / 60);
    const fee = 10 + Math.ceil(meters / 100) * 0.5;
    res.json({ meters, minutes, fee: Math.ceil(fee) });
  } catch {
    // graceful fallback
    res.status(200).json({ meters: 500, minutes: 10, fee: 20, note: "fallback" });
  }
});

// --- Checkout (tolerant to client ids / snapshots)
app.post("/api/cart/checkout", async (req, res) => {
    try {
      // 🔍 see exactly what arrived
      console.log("POST /api/cart/checkout headers:", req.headers);
      console.log("POST /api/cart/checkout body:", req.body);
  
      const campus = (req.body?.campus || "ADMU").toString();
      const pickup = (req.body?.pickup || "Gate 2.5").toString();
  
      // Accept multiple payload shapes:
      // { items: [...] }  OR  [...]  OR  { cart: [...] }
      let items = [];
      if (Array.isArray(req.body)) items = req.body;
      else if (Array.isArray(req.body?.items)) items = req.body.items;
      else if (Array.isArray(req.body?.cart))  items = req.body.cart;
  
      // Normalize
      const norm = (items || []).map(i => ({
        productId: String(i.productId || i.id || i.name || "").trim(),
        qty: Number(i.qty ?? i.quantity ?? 1),
        priceSnap: Number(i.price ?? 0),
      }));
  
      // If nothing came through, return a diagnostic instead of hard 400
      if (norm.length === 0) {
        return res.status(422).json({
          error: "No items received",
          hint: "Check Content-Type: application/json and request body shape",
          received: req.body
        });
      }
  
      // Try DB prices; fall back to snapshot
      const ids = norm.filter(i => i.productId).map(i => i.productId);
      const found = await prisma.product.findMany({ where: { id: { in: ids } } });
      const priceMap = Object.fromEntries(found.map(p => [p.id, p.price]));
  
      const total = norm.reduce((sum, i) => {
        const dbPrice = Number.isFinite(priceMap[i.productId]) ? priceMap[i.productId] : null;
        const unit = dbPrice ?? (Number.isFinite(i.priceSnap) ? i.priceSnap : 0);
        const qty  = Number.isFinite(i.qty) && i.qty > 0 ? i.qty : 1;
        return sum + unit * qty;
      }, 0);
  
      const order = await prisma.order.create({
        data: {
          campus, pickup,
          total: Math.max(0, Math.round(total)),
          items: {
            create: norm.map(i => ({
              productId: i.productId || "CLIENT-ID",
              qty: (Number.isFinite(i.qty) && i.qty > 0) ? i.qty : 1,
              price: Number.isFinite(priceMap[i.productId])
                ? priceMap[i.productId]
                : (Number.isFinite(i.priceSnap) ? i.priceSnap : 0),
            }))
          }
        }
      });
  
      return res.json({ orderId: order.id });
    } catch (e) {
      console.error("Checkout server error:", e);
      return res.status(500).json({ error: "Checkout failed", message: String(e?.message || e) });
    }
  });
  


const PORT = process.env.PORT || 8000; 

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`); 
  console.log(`URL: http://localhost:${PORT}`);
});