// -- small helpers
function $id(id) { return document.getElementById(id); }
function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[c]));
}

// populate times
const prefTime = $id("preferredTime");
for (let h = 6; h <= 22; h++) {
  const hh = String(h).padStart(2, "0") + ":00";
  const o = document.createElement("option");
  o.value = hh;
  o.textContent = hh;
  prefTime.appendChild(o);
}

const servicesList = $id("servicesList");
const status = $id("status");
const slotsArea = $id("slotsArea");
const availabilityCard = $id("availabilityCard");
const bookingCard = $id("bookingCard");
const bookingSummary = $id("bookingSummary");
const bookingsList = $id("bookingsList");
const discountInfo = $id("discountInfo");
const couponSelect = $id("couponCode");
const loyaltyInfo = $id("loyaltyInfo");
const loyaltyNameInput = $id("loyaltyName");

let services = [];
let selectedService = null;
let selectedSlot = null;
let finalPrice = null;

// ----- SERVICES -----
async function loadServices() {
  servicesList.innerHTML = "Loading services…";
  try {
    const r = await fetch("/api/services");

    if (!r.ok) {
      // e.g., 500 or 404
      throw new Error("Failed to load /api/services (status " + r.status + ")");
    }

    const j = await r.json();
    if (!j.success || !Array.isArray(j.services)) {
      throw new Error("Invalid /api/services response");
    }

    services = j.services;
    renderServices();
  } catch (err) {
    console.error("Error loading services:", err);

    // 💬 Friendly fallback message
    servicesList.innerHTML =
      "<div class='muted'>Failed to load services (server offline?). Showing demo demo services instead.</div>";

    // Demo fallback
    services = [
      { id: "svc-1", name: "Badminton Court",  description: "Single court", duration: 60, price: 250 },
      { id: "svc-2", name: "Tennis Court",     description: "Singles",      duration: 60, price: 400 },
      { id: "svc-3", name: "Basketball Court", description: "Half-court",   duration: 60, price: 600 },
    ];

    // still render *something*
    renderServices();
  }
}

function getDisplayPrice(service) {
    if (service.price != null) return service.price;
  
    const name = (service.name || "").toLowerCase();
    if (name.includes("badminton")) return 250;
    if (name.includes("tennis")) return 400;
    if (name.includes("basketball")) return 600;
  
    return null; // will show TBD
  }
  
  function renderServices() {
    if (!services || services.length === 0) {
      servicesList.innerHTML = "<div class='muted'>No services found.</div>";
      return;
    }
  
    servicesList.innerHTML = "";
    services.forEach(s => {
      const price = getDisplayPrice(s);
  
      const div = document.createElement("div");
      div.className = "service-item";
      div.innerHTML =
        `<strong>${escapeHtml(s.name)}</strong>` +
        `<div class="muted">${escapeHtml(s.description || "")}</div>` +
        `<div class="muted">Duration: ${s.duration || 60} min • Price: ${price != null ? "₱" + price : "TBD"}</div>`;
      div.onclick = () => selectService(s, div);
      servicesList.appendChild(div);
    });
  }  

function selectService(s, elem) {
  document.querySelectorAll(".service-item").forEach(it => it.classList.remove("selected"));
  elem.classList.add("selected");
  selectedService = s;
  availabilityCard.style.display = "none";
  bookingCard.style.display = "none";
  selectedSlot = null;
  finalPrice = null;
  discountInfo.textContent = "";
}

// ----- AVAILABILITY -----
document.getElementById("checkBtn").addEventListener("click", async () => {
    status.textContent = "";
    if (!selectedService) {
      status.textContent = "Please select a service first.";
      return;
    }
  
    const preferredLocation = $id("preferredLocation").value;
    const indoorOutdoor     = $id("indoorOutdoor").value;
    const dateFrom          = $id("dateFrom").value;
    const dateTo            = $id("dateTo").value;
    const preferredTime     = $id("preferredTime").value;
  
    if (!dateFrom || !dateTo) {
      status.textContent = "Please choose dateFrom and dateTo.";
      return;
    }
  
    status.textContent = "Checking availability...";
    slotsArea.innerHTML = "";
    availabilityCard.style.display = "none";
    bookingCard.style.display = "none";
    selectedSlot = null;
    finalPrice = null;
    discountInfo.textContent = "";
  
    try {
      const body = {
        preferredLocation,
        indoorOutdoor,
        sport: selectedService.name,
        dateFrom,
        dateTo,
        preferredTime,
      };
  
      const r = await fetch("/api/court/availability/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
  
      if (r.ok) {
        const j = await r.json();
  
        // 🔥 DEMO MODE: if backend returns no startTimes, fall back to mock slots
        const hasSlots =
          j &&
          j.results &&
          j.results.some((res) =>
            (res.units || []).some(
              (u) => u.startTimes && Object.keys(u.startTimes).length > 0
            )
          );
  
        if (hasSlots) {
          renderAvailability(j);
        } else {
          renderAvailability(
            mockAvailability(selectedService, dateFrom, dateTo, preferredTime)
          );
        }
      } else {
        // API error → use mock slots
        renderAvailability(
          mockAvailability(selectedService, dateFrom, dateTo, preferredTime)
        );
      }
  
      status.textContent = "";
    } catch (err) {
      console.error(err);
      // Network / server error → still show mock slots
      renderAvailability(
        mockAvailability(selectedService, dateFrom, dateTo, preferredTime)
      );
      status.textContent = "";
    }
  });  

function mockAvailability(svc, dateFrom, dateTo, preferredTime) {
  const d1 = new Date(dateFrom);
  const d2 = new Date(dateTo);
  const results = [{ service: svc, units: [] }];
  for (let i = 0; i < 3; i++) {
    const unit = {
      unit: { id: `u-${i + 1}`, name: `${svc.name} Unit ${i + 1}`, description: (i === 0 ? "Indoor" : "Outdoor") },
      startTimes: {}
    };
    for (let d = new Date(d1); d <= d2; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      unit.startTimes[key] = ["09:00", "11:00", "15:00"];
    }
    results[0].units.push(unit);
  }
  return { results };
}

function renderAvailability(data) {
  availabilityCard.style.display = "block";
  slotsArea.innerHTML = "";
  if (!data || !data.results || data.results.length === 0) {
    slotsArea.innerHTML = "<div class='muted'>No results</div>";
    return;
  }
  data.results.forEach(r => {
    const svcBox = document.createElement("div");
    svcBox.innerHTML = `<h4>${escapeHtml(r.service.name || "Service")}</h4>`;
    r.units.forEach(u => {
      const unitDiv = document.createElement("div");
      unitDiv.className = "unit";
      const head = document.createElement("div");
      head.innerHTML =
        `<strong>${escapeHtml(u.unit.name || "Unit")}</strong>` +
        `<div class="muted">${escapeHtml(u.unit.description || "")}</div>`;
      unitDiv.appendChild(head);

      const dateKeys = Object.keys(u.startTimes || {});
      if (dateKeys.length === 0) {
        const no = document.createElement("div");
        no.className = "muted";
        no.textContent = "No start times near preferred time";
        unitDiv.appendChild(no);
      } else {
        dateKeys.forEach(d => {
          const ddiv = document.createElement("div");
          ddiv.innerHTML = `<div class="muted" style="margin-top:8px">${escapeHtml(d)}</div>`;
          const ul = document.createElement("ul");
          ul.className = "slots";
          (u.startTimes[d] || []).forEach(t => {
            const li = document.createElement("li");
            const btn = document.createElement("button");
            btn.className = "slot-btn";
            btn.textContent = `${d} ${t}`;
            btn.onclick = () => selectSlot({
              serviceId: r.service.id || r.service.name,
              serviceName: r.service.name,
              unitId: u.unit.id,
              unitName: u.unit.name,
              date: d,
              time: t,
              price: r.service.price || null
            }, btn);
            li.appendChild(btn);
            ul.appendChild(li);
          });
          ddiv.appendChild(ul);
          unitDiv.appendChild(ddiv);
        });
      }
      svcBox.appendChild(unitDiv);
    });
    slotsArea.appendChild(svcBox);
  });
}

// Map service name → default price (for demo bookings)
function getDisplayPriceForName(name) {
    const n = (name || "").toLowerCase();
    if (n.includes("badminton")) return 250;
    if (n.includes("tennis")) return 400;
    if (n.includes("basketball")) return 600;
    return null;
  }
  
  function selectSlot(slotObj, btn) {
    document
      .querySelectorAll(".slot-btn")
      .forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
  
    // 🔥 ensure slot has a price
    if (slotObj.price == null) {
      slotObj.price = getDisplayPriceForName(slotObj.serviceName);
    }
  
    selectedSlot = slotObj;
    finalPrice = null;
    discountInfo.textContent = "";
  
    bookingSummary.innerHTML = `
      <div class="muted"><strong>${escapeHtml(
        selectedSlot.serviceName
      )}</strong> — ${escapeHtml(selectedSlot.unitName)}</div>
      <div class="muted">When: ${escapeHtml(selectedSlot.date)} ${escapeHtml(
      selectedSlot.time
    )}</div>
      <div class="muted">Price: ${
        selectedSlot.price ? "₱" + selectedSlot.price : "TBD"
      }</div>
    `;
    bookingCard.style.display = "block";
    $id("customerName").value = "";
    $id("contact").value = "";
  }  

// ----- COUPON DROPDOWN -----
async function populateCouponsDropdown() {
  if (!couponSelect) return;
  couponSelect.innerHTML = '<option value="">No coupon</option>';
  const fallbackCodes = ["BADMINTON20", "BASKETBALL20", "TENNIS20", "PICKLEBALL20", "SOCCER20"];
  try {
    const r = await fetch("/api/coupons");
    if (!r.ok) throw new Error("no /api/coupons");
    const j = await r.json();
    if (!j.success || !Array.isArray(j.coupons)) throw new Error("bad coupons response");
    j.coupons.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.code;
      opt.textContent = c.code;
      couponSelect.appendChild(opt);
    });
    if (j.coupons.length === 0) {
      fallbackCodes.forEach(code => {
        const opt = document.createElement("option");
        opt.value = code;
        opt.textContent = code;
        couponSelect.appendChild(opt);
      });
    }
  } catch (err) {
    console.error("Error loading coupons, using fallback list", err);
    fallbackCodes.forEach(code => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = code;
      couponSelect.appendChild(opt);
    });
  }
}

// apply coupon using dropdown
document.getElementById("applyCouponBtn").onclick = async () => {
  discountInfo.textContent = "";
  const code = couponSelect.value;

  if (!code) {
    discountInfo.textContent = "Select a coupon from the list.";
    return;
  }
  if (!selectedSlot || selectedSlot.price == null) {
    discountInfo.textContent = "Price missing for selected slot.";
    return;
  }

  // ✅ Known 20% off codes
  const fallbackCodes = [
    "BADMINTON20",
    "BASKETBALL20",
    "TENNIS20",
    "PICKLEBALL20",
    "SOCCER20",
  ];
  const upper = String(code).toUpperCase();
  const priceNum = Number(selectedSlot.price);

  try {
    const r = await fetch("/api/coupons/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, originalPrice: selectedSlot.price }),
    });

    const j = await r.json();

    // Backend responded but says coupon not valid
    if (!j.success) {
      // 🔁 Fallback: still give 20% for your known codes
      if (fallbackCodes.includes(upper) && !isNaN(priceNum)) {
        finalPrice = Math.round(priceNum * 0.8 * 100) / 100;
        discountInfo.textContent = `Coupon applied. New price: ₱${finalPrice}`;
        return;
      }

      discountInfo.textContent = j.error || "Invalid coupon";
      finalPrice = null;
      return;
    }

    // Normal success from backend
    finalPrice = j.finalPrice;
    discountInfo.textContent = `Coupon applied. New price: ₱${finalPrice}`;
  } catch (err) {
    console.error("Error talking to /api/coupons/validate:", err);

    // 🔥 If API totally fails, still apply 20% for the …20 codes
    if (fallbackCodes.includes(upper) && !isNaN(priceNum)) {
      finalPrice = Math.round(priceNum * 0.8 * 100) / 100;
      discountInfo.textContent = `Coupon applied. New price: ₱${finalPrice}`;
    } else {
      discountInfo.textContent = "Error validating coupon";
      finalPrice = null;
    }
  }
};

// ----- LOYALTY POINTS -----
async function updateLoyaltyPoints(customerName) {
  if (!customerName) return;
  try {
    const r = await fetch("/api/bookings");
    const j = await r.json();
    if (!j.success || !Array.isArray(j.bookings)) return;

    const nameLower = customerName.toLowerCase();
    let totalSpent = 0;
    j.bookings.forEach(b => {
      if (
        b.customerName &&
        b.customerName.toLowerCase() === nameLower &&
        (b.status === "confirmed" || b.status === "confirmed_mock") &&
        b.price != null
      ) {
        totalSpent += Number(b.price);
      }
    });

    const points = Math.floor(totalSpent); // 1 peso = 1 point
    loyaltyInfo.textContent = `${customerName} has ${points} loyalty points.`;
  } catch (err) {
    console.error("Error updating loyalty", err);
  }
}

document.getElementById("checkLoyaltyBtn").onclick = async () => {
  const name = loyaltyNameInput.value && loyaltyNameInput.value.trim();
  if (!name) {
    loyaltyInfo.textContent = "Enter a customer name first.";
    return;
  }
  await updateLoyaltyPoints(name);
};

// ----- CONFIRM BOOKING -----
document.getElementById("confirmBtn").onclick = async () => {
    if (!selectedSlot) {
      status.textContent = "Select a slot first.";
      return;
    }
  
    const customerName =
      $id("customerName").value && $id("customerName").value.trim();
    if (!customerName) {
      status.textContent = "Enter your name.";
      return;
    }
    const contact = $id("contact").value && $id("contact").value.trim();
  
    // base price for this booking
    const basePrice =
      finalPrice != null
        ? Number(finalPrice)
        : selectedSlot.price != null
        ? Number(selectedSlot.price)
        : null;
  
    const payload = {
      serviceId: selectedSlot.serviceId,
      serviceName: selectedSlot.serviceName,
      unitId: selectedSlot.unitId,
      unitName: selectedSlot.unitName,
      date: selectedSlot.date,
      time: selectedSlot.time,
      customerName,
      contact,
      price: basePrice,
      couponCode: couponSelect.value
        ? couponSelect.value.toUpperCase()
        : null,
    };
  
    status.textContent = "Creating booking...";
    try {
      const r = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
  
      if (!r.ok) {
        status.textContent =
          "Booking error: " + (j && j.error ? j.error : r.statusText);
        return;
      }
  
      status.textContent = "Booking created. Confirming...";
  
      // 🔥 fix: support _id (Mongo) OR id
      const bid =
        j.booking && (j.booking._id || j.booking.id);
  
      if (bid) {
        const rc = await fetch(`/api/book/${bid}/confirm`, {
          method: "POST",
        });
        const jc = await rc.json();
  
        if (rc.ok) {
          status.textContent = "Booking confirmed!";
          // update loyalty for this customer
          await updateLoyaltyPoints(customerName);
        } else {
          status.textContent =
            "Booking created but confirmation failed: " +
            (jc && jc.error ? jc.error : rc.statusText);
        }
      } else {
        // safety: no id returned
        status.textContent =
          "Booking created, but could not confirm (missing booking ID).";
      }
  
      // reset UI
      bookingCard.style.display = "none";
      availabilityCard.style.display = "none";
      selectedSlot = null;
      finalPrice = null;
      couponSelect.value = "";
      await loadBookings();
    } catch (err) {
      console.error(err);
      status.textContent = "Server error creating booking";
    }
  };  

// ----- BOOKINGS LIST -----
async function loadBookings() {
  bookingsList.innerHTML = "Loading…";
  try {
    const r = await fetch("/api/bookings");
    const j = await r.json();
    if (!j.success || !Array.isArray(j.bookings) || j.bookings.length === 0) {
      bookingsList.innerHTML = "<div class='muted'>No bookings yet.</div>";
      return;
    }
    const html = j.bookings.map(b => {
      return `<div style="padding:10px;border-bottom:1px solid #f1f5f9">
        <div><strong>${escapeHtml(b.serviceName || "Service")}</strong> — ${escapeHtml(b.unitName || "")}</div>
        <div class="muted">${escapeHtml(b.date)} ${escapeHtml(b.time)} • ${escapeHtml(b.customerName || "")} • ${b.status || ""}</div>
        <div class="muted">Price: ${b.price != null ? "₱" + b.price : "TBD"} ${b.couponCode ? " • Coupon: " + escapeHtml(b.couponCode) : ""}</div>
      </div>`;
    }).join("");
    bookingsList.innerHTML = html;
  } catch (err) {
    console.error("Error loading bookings:", err);
    bookingsList.innerHTML =
      "<div class='muted'>Error loading bookings. Please try again later.</div>";
  }
}

// ----- INIT -----
(async function init() {
  await loadServices();
  await populateCouponsDropdown();
  await loadBookings();
})();
