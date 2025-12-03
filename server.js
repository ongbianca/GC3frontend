// server.js  — Courtify full backend (local JSON storage)

const express = require("express");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());
app.use(cors());

// Serve static frontend (index.html, style.css, etc.)
app.use(express.static(path.join(__dirname)));

const BOOKINGS_FILE = path.join(__dirname, "bookings.json");
const COUPONS_FILE  = path.join(__dirname, "coupons.json");

const MOCK_MODE = process.env.MOCK_MODE === "true";

// ---------- helpers for JSON files ----------

async function ensureFile(filePath, defaultValue = "[]") {
  try {
    await fsp.access(filePath, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(filePath, defaultValue, "utf8");
  }
}

async function readFileSafe(filePath) {
  await ensureFile(filePath);
  const raw = await fsp.readFile(filePath, "utf8");
  return raw.trim() ? JSON.parse(raw) : [];
}

async function writeFileSafe(filePath, data) {
  const tmp = filePath + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fsp.rename(tmp, filePath);
}

const readBookingsSafe = () => readFileSafe(BOOKINGS_FILE);
const writeBookingsSafe = data => writeFileSafe(BOOKINGS_FILE, data);

const readCouponsSafe = async () => {
  // if file empty, seed default 20% coupons for sports
  await ensureFile(COUPONS_FILE);
  const raw = await fsp.readFile(COUPONS_FILE, "utf8");
  let data = raw.trim() ? JSON.parse(raw) : [];
  if (!Array.isArray(data) || data.length === 0) {
    data = [
      { id: uuidv4(), code: "BADMINTON20", type: "percent", amount: 20, maxUses: 9999, used: 0 },
      { id: uuidv4(), code: "BASKETBALL20", type: "percent", amount: 20, maxUses: 9999, used: 0 },
      { id: uuidv4(), code: "TENNIS20", type: "percent", amount: 20, maxUses: 9999, used: 0 },
      { id: uuidv4(), code: "PICKLEBALL20", type: "percent", amount: 20, maxUses: 9999, used: 0 },
      { id: uuidv4(), code: "SOCCER20", type: "percent", amount: 20, maxUses: 9999, used: 0 }
    ];
    await writeFileSafe(COUPONS_FILE, data);
  }
  return data;
};
const writeCouponsSafe = data => writeFileSafe(COUPONS_FILE, data);

// ---------- booking helpers ----------

function hasConflict(bookings, unitId, date, time, excludeId = null) {
  return bookings.some(b => {
    if (excludeId && b.id === excludeId) return false;
    if (b.status === "cancelled") return false;
    return (
      String(b.unitId) === String(unitId) &&
      String(b.date) === String(date) &&
      String(b.time) === String(time)
    );
  });
}

function pushHistory(booking, actor, action, note = "") {
  booking.history = booking.history || [];
  booking.history.push({
    ts: new Date().toISOString(),
    actor: actor || "system",
    action,
    note
  });
}

// ---------- health ----------

app.get("/api/ping", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ---------- simple services API (for /api/services) ----------
// For demo: simulate a server failure so frontend fallback kicks in.

app.get("/api/services", (req, res) => {
  console.error("Simulated /api/services failure for demo");
  return res
    .status(500)
    .json({ success: false, error: "Simulated server error" });
});

// ---------- BOOKINGS ----------

// Create booking
app.post("/api/book", async (req, res) => {
  const p = req.body || {};

  if (!p.serviceId || !p.unitId || !p.date || !p.time || !p.customerName) {
    return res
      .status(400)
      .json({ success: false, error: "Missing required fields" });
  }

  const bookings = await readBookingsSafe();

  if (hasConflict(bookings, p.unitId, p.date, p.time)) {
    return res
      .status(409)
      .json({ success: false, error: "Time slot already booked" });
  }

  const now = new Date().toISOString();
  const booking = {
    id: uuidv4(),
    serviceId: p.serviceId,
    serviceName: p.serviceName || null,
    unitId: p.unitId,
    unitName: p.unitName || null,
    date: p.date,
    time: p.time,
    customerName: p.customerName,
    contact: p.contact || null,
    price: p.price != null ? Number(p.price) : null,
    couponCode: p.couponCode || null,
    status: MOCK_MODE ? "confirmed_mock" : "pending",
    confirmationCode: null,
    createdAt: now,
    updatedAt: now,
    history: []
  };

  pushHistory(booking, "system", "created", "Booking created");
  bookings.push(booking);
  await writeBookingsSafe(bookings);

  res.status(201).json({ success: true, booking });
});

// Confirm booking (just confirms; price already includes any coupon discount)
app.post("/api/book/:id/confirm", async (req, res) => {
  const id = req.params.id;
  const bookings = await readBookingsSafe();
  const idx = bookings.findIndex(b => b.id === id);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: "Booking not found" });
  }

  const booking = bookings[idx];
  if (booking.status === "cancelled") {
    return res
      .status(400)
      .json({ success: false, error: "Cannot confirm a cancelled booking" });
  }

  booking.status = MOCK_MODE ? "confirmed_mock" : "confirmed";
  booking.updatedAt = new Date().toISOString();
  pushHistory(booking, "system", "confirmed", "Booking confirmed");

  bookings[idx] = booking;
  await writeBookingsSafe(bookings);

  res.json({ success: true, booking });
});

// Reschedule booking
app.post("/api/book/:id/reschedule", async (req, res) => {
  const { date, time } = req.body || {};
  if (!date || !time) {
    return res
      .status(400)
      .json({ success: false, error: "date and time required" });
  }

  const bookings = await readBookingsSafe();
  const idx = bookings.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false });

  const booking = bookings[idx];

  if (hasConflict(bookings, booking.unitId, date, time, booking.id)) {
    return res
      .status(409)
      .json({ success: false, error: "Reschedule conflict" });
  }

  const old = `${booking.date} ${booking.time}`;
  booking.date = date;
  booking.time = time;
  booking.updatedAt = new Date().toISOString();
  pushHistory(booking, "user", "rescheduled", `From ${old} to ${date} ${time}`);

  bookings[idx] = booking;
  await writeBookingsSafe(bookings);

  res.json({ success: true, booking });
});

// Cancel booking
app.post("/api/book/:id/cancel", async (req, res) => {
  const bookings = await readBookingsSafe();
  const idx = bookings.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false });

  const booking = bookings[idx];
  booking.status = "cancelled";
  booking.updatedAt = new Date().toISOString();
  pushHistory(booking, "user", "cancelled", "Booking cancelled");

  bookings[idx] = booking;
  await writeBookingsSafe(bookings);

  res.json({ success: true, booking });
});

// List bookings — IMPORTANT: returns { success, bookings }
app.get("/api/bookings", async (req, res) => {
  const bookings = await readBookingsSafe();
  res.json({ success: true, bookings });
});

// Simple admin analytics (optional)
app.get("/api/admin/analytics", async (req, res) => {
  const bookings = await readBookingsSafe();
  const revenue = bookings.reduce(
    (sum, b) => sum + (b.price != null ? Number(b.price) : 0),
    0
  );
  res.json({
    success: true,
    metrics: {
      totalBookings: bookings.length,
      confirmed: bookings.filter(b => b.status === "confirmed").length,
      cancelled: bookings.filter(b => b.status === "cancelled").length,
      revenue
    }
  });
});

// ---------- COUPONS ----------

// List coupons for dropdown
app.get("/api/coupons", async (req, res) => {
  try {
    const coupons = await readCouponsSafe();
    res.json({ success: true, coupons });
  } catch (err) {
    console.error("GET /api/coupons error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// Validate coupon & compute discounted price
// body: { code, originalPrice }
app.post("/api/coupons/validate", async (req, res) => {
  const { code, originalPrice } = req.body || {};
  if (!code || originalPrice == null) {
    return res
      .status(400)
      .json({ success: false, error: "code and originalPrice required" });
  }

  try {
    const coupons = await readCouponsSafe();
    const coupon = coupons.find(
      c => c.code === String(code).toUpperCase()
    );
    if (!coupon) {
      return res
        .status(404)
        .json({ success: false, error: "Invalid coupon" });
    }

    if ((coupon.used || 0) >= (coupon.maxUses || 999999)) {
      return res
        .status(400)
        .json({ success: false, error: "Coupon max uses reached" });
    }

    let finalPrice = Number(originalPrice);
    if (coupon.type === "percent") {
      finalPrice = finalPrice - (finalPrice * Number(coupon.amount) / 100);
    } else if (coupon.type === "fixed") {
      finalPrice = Math.max(0, finalPrice - Number(coupon.amount));
    }
    finalPrice = Math.round(finalPrice * 100) / 100;

    res.json({
      success: true,
      finalPrice,
      coupon: { code: coupon.code, type: coupon.type, amount: coupon.amount }
    });
  } catch (err) {
    console.error("POST /api/coupons/validate error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// ---------- SPA fallback (so hitting / just serves index.html) ----------

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ---------- start server ----------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Courtify server running at http://localhost:${PORT}`);
});
