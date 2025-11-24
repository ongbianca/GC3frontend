// server.js
// GC Mini — simple in-memory API for availability + price estimation

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ------------------ In-memory data ------------------

const facilities = [
  {
    id: "courtify-sportsplex",
    name: "Courtify Sportsplex",
    hourlyRate: 500,
    openHour: 8,
    closeHour: 22,
    bookings: [
      { date: "2025-10-10", start: "10:00", end: "11:30" }
    ]
  }
];

// ------------------ Helpers ------------------

function findFacility(id) {
  return facilities.find(f => f.id === id);
}

function isValidDateStr(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str);
}

function isValidTimeStr(str) {
  return /^\d{2}:\d{2}$/.test(str);
}

function toMinutes(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function addMinutes(time, minutes) {
  return fromMinutes(toMinutes(time) + minutes);
}

function isPastDate(dateStr) {
  const today = new Date().toISOString().slice(0, 10);
  return dateStr < today;
}

function hasConflictForFacility(facility, date, startTime, endTime) {
  const s = toMinutes(startTime);
  const e = toMinutes(endTime);

  for (const b of facility.bookings) {
    if (b.date !== date) continue;
    const bs = toMinutes(b.start);
    const be = toMinutes(b.end);
    if (s < be && e > bs) return b;
  }
  return null;
}

// ------------------ 1. POST /api/availability/check ------------------

app.post("/api/availability/check", (req, res) => {
  const { facilityId, date, startTime, durationMinutes } = req.body || {};

  if (!facilityId) return res.status(400).json({ message: "facilityId is required" });
  if (!date) return res.status(400).json({ message: "date is required" });
  if (!startTime) return res.status(400).json({ message: "startTime is required" });
  if (durationMinutes == null) return res.status(400).json({ message: "durationMinutes is required" });

  if (!isValidDateStr(date)) return res.status(422).json({ message: "date must be YYYY-MM-DD" });
  if (!isValidTimeStr(startTime)) return res.status(422).json({ message: "startTime must be HH:mm" });

  const dur = Number(durationMinutes);
  if (!Number.isInteger(dur) || dur < 30) return res.status(422).json({ message: "durationMinutes must be integer ≥ 30" });

  if (isPastDate(date)) return res.status(422).json({ message: "date cannot be in the past" });

  const facility = findFacility(facilityId);
  if (!facility) return res.status(404).json({ message: "facility not found" });

  const end = addMinutes(startTime, dur);
  const sMin = toMinutes(startTime);
  const eMin = toMinutes(end);

  const openMin = facility.openHour * 60;
  const closeMin = facility.closeHour * 60;

  if (sMin < openMin || eMin > closeMin) {
    return res.status(422).json({
      message: "Requested time is outside facility hours",
      open: facility.openHour,
      close: facility.closeHour
    });
  }

  const conflict = hasConflictForFacility(facility, date, startTime, end);

  if (!conflict) {
    return res.json({
      facilityId,
      date,
      startTime,
      endTime: end,
      isAvailable: true
    });
  }

  const nextStart = conflict.end;
  const nextEnd = addMinutes(nextStart, dur);
  const nextStartMin = toMinutes(nextStart);
  const nextEndMin = toMinutes(nextEnd);

  let nextAvailable = null;

  if (nextStartMin >= openMin && nextEndMin <= closeMin) {
    nextAvailable = {
      startTime: nextStart,
      endTime: nextEnd
    };
  }

  return res.json({
    facilityId,
    date,
    startTime,
    endTime: end,
    isAvailable: false,
    conflict: { start: conflict.start, end: conflict.end },
    nextAvailable
  });
});

// ------------------ 2. POST /api/booking/estimate ------------------

app.post("/api/booking/estimate", (req, res) => {
  const { facilityId, durationMinutes } = req.body || {};

  if (!facilityId) return res.status(400).json({ message: "facilityId is required" });
  if (durationMinutes == null) return res.status(400).json({ message: "durationMinutes is required" });

  const dur = Number(durationMinutes);
  if (!Number.isInteger(dur) || dur < 30)
    return res.status(422).json({ message: "durationMinutes must be integer ≥ 30" });

  const facility = findFacility(facilityId);
  if (!facility) return res.status(404).json({ message: "facility not found" });

  const price = (facility.hourlyRate * dur) / 60;

  return res.json({
    facilityId,
    hourlyRate: facility.hourlyRate,
    durationMinutes: dur,
    estimatedPrice: price,
    currency: "PHP"
  });
});

// ------------------ Start server ------------------

app.listen(PORT, () => {
  console.log(`GC Mini API running on http://localhost:${PORT}`);
});
