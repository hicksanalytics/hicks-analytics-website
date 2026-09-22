const navToggle = document.querySelector(".nav-toggle");
const nav = document.querySelector(".primary-nav");

function closeMenu() {
  nav.classList.remove("open");
  navToggle.setAttribute("aria-expanded", "false");
  document.body.classList.remove("menu-open");
}

if (navToggle && nav) {
  navToggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
    document.body.classList.toggle("menu-open", isOpen);
  });

  nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
}

const year = document.querySelector("#year");
if (year) year.textContent = new Date().getFullYear();
// Hicks Analytics prospect attribution + event tracking
const ATTRIBUTION_KEY = "ha_attribution_v1";
const SESSION_KEY = "ha_tracking_session_v1";

function getStoredAttribution() {
  try {
    return JSON.parse(localStorage.getItem(ATTRIBUTION_KEY) || "{}");
  } catch {
    return {};
  }
}

function normalizeProspectId(value) {
  return value ? value.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

const params = new URLSearchParams(window.location.search);
const now = Date.now();
const previous = getStoredAttribution();

const incomingProspectId = normalizeProspectId(params.get("pid"));
const prospectChanged =
  incomingProspectId &&
  previous.prospect_id &&
  incomingProspectId !== previous.prospect_id;

const attribution = prospectChanged ? {} : { ...previous };

if (incomingProspectId) attribution.prospect_id = incomingProspectId;
if (params.get("utm_campaign")) attribution.campaign = params.get("utm_campaign");
if (params.get("utm_source")) attribution.utm_source = params.get("utm_source");
if (params.get("utm_medium")) attribution.utm_medium = params.get("utm_medium");
if (params.get("utm_content")) attribution.utm_content = params.get("utm_content");

if (attribution.utm_content) {
  const match = attribution.utm_content.match(/_([a-z0-9]+)$/i);
  if (match) attribution.message_variant = match[1].toUpperCase();
}

const priorLastVisit = prospectChanged ? 0 : Number(previous.last_visit_at || 0);

const isReturnVisit =
  Boolean(
    attribution.prospect_id &&
    previous.prospect_id === attribution.prospect_id &&
    priorLastVisit &&
    now - priorLastVisit > 30 * 60 * 1000
  );

if (attribution.prospect_id) {
  attribution.first_visit_at =
    prospectChanged || !previous.first_visit_at
      ? now
      : previous.first_visit_at;

  attribution.last_visit_at = now;

  localStorage.setItem(
    ATTRIBUTION_KEY,
    JSON.stringify(attribution)
  );
}

const analyticsProperties = Object.fromEntries(
  Object.entries({
    prospect_id: attribution.prospect_id,
    campaign: attribution.campaign,
    message_variant: attribution.message_variant,
    utm_source: attribution.utm_source,
    utm_medium: attribution.utm_medium,
    utm_content: attribution.utm_content
  }).filter(([, value]) => Boolean(value))
);

// Attach prospect attribution to future PostHog events.
if (window.posthog && Object.keys(analyticsProperties).length) {
  posthog.register(analyticsProperties);
}

// Attach anonymous prospect ID / campaign tags to Clarity sessions.
if (window.clarity && attribution.prospect_id) {
  clarity("identify", attribution.prospect_id);
  clarity("set", "prospect_id", attribution.prospect_id);

  if (attribution.campaign) {
    clarity("set", "campaign", attribution.campaign);
  }

  if (attribution.message_variant) {
    clarity("set", "message_variant", attribution.message_variant);
  }
}

function captureAnalytics(eventName, properties = {}) {
  const eventProperties = {
    ...analyticsProperties,
    ...properties
  };

  if (window.posthog) {
    posthog.capture(eventName, eventProperties);
  }

  if (window.clarity) {
    clarity("event", eventName);
  }
}

function captureOncePerSession(eventName, properties = {}) {
  const key = `ha_${eventName}`;

  if (sessionStorage.getItem(key)) return;

  sessionStorage.setItem(key, "1");
  captureAnalytics(eventName, properties);
}

// Prospect landing / return visit
if (
  attribution.prospect_id &&
  !sessionStorage.getItem(SESSION_KEY)
) {
  captureAnalytics("prospect_landing", {
    landing_path: window.location.pathname,
    landing_query: window.location.search,
    referrer: document.referrer || "",
    return_visit: isReturnVisit
  });

  if (isReturnVisit) {
    captureAnalytics("return_visit", {
      hours_since_last_visit: Math.round(
        (now - priorLastVisit) / 3600000
      )
    });
  }

  sessionStorage.setItem(SESSION_KEY, "1");
}

// Track when important sections are actually viewed.
function trackSection(selector, eventName) {
  const element = document.querySelector(selector);

  if (!element) return;

  const observer = new IntersectionObserver(
    (entries) => {
      const viewed = entries.some(
        (entry) =>
          entry.isIntersecting &&
          entry.intersectionRatio >= 0.4
      );

      if (viewed) {
        captureOncePerSession(eventName);
        observer.disconnect();
      }
    },
    { threshold: [0.4] }
  );

  observer.observe(element);
}

trackSection("#work", "case_study_viewed");
trackSection("#services", "services_viewed");

// Calendly popup + booking tracking
let lastCalendlyCtaLocation = "unknown";

document
  .querySelectorAll('a[href*="calendly.com/hicksanalytics"]')
  .forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();

      lastCalendlyCtaLocation =
        link.closest("header") ? "nav" :
        link.closest(".hero") ? "hero" :
        link.closest("#contact") ? "contact" :
        "other";

      captureAnalytics("book_call_clicked", {
        cta_location: lastCalendlyCtaLocation
      });

      const calendlyUtm = {};

      if (attribution.utm_source) {
        calendlyUtm.utmSource = attribution.utm_source;
      }

      if (attribution.utm_medium) {
        calendlyUtm.utmMedium = attribution.utm_medium;
      }

      if (attribution.campaign) {
        calendlyUtm.utmCampaign = attribution.campaign;
      }

      if (attribution.utm_content) {
        calendlyUtm.utmContent = attribution.utm_content;
      }

      if (
        window.Calendly &&
        typeof window.Calendly.initPopupWidget === "function"
      ) {
        window.Calendly.initPopupWidget({
          url: link.href,
          utm: calendlyUtm
        });
      } else {
        // Fallback if Calendly's script has not loaded yet
        window.open(link.href, "_blank", "noopener");
      }
    });
  });

// Calendly tells the parent page when a real booking is completed.
window.addEventListener("message", (event) => {
  let isCalendlyOrigin = false;

  try {
    const hostname = new URL(event.origin).hostname;

    isCalendlyOrigin =
      hostname === "calendly.com" ||
      hostname.endsWith(".calendly.com");
  } catch {
    return;
  }

  if (
    isCalendlyOrigin &&
    event.data &&
    event.data.event === "calendly.event_scheduled"
  ) {
    captureOncePerSession("meeting_booked", {
      booking_source: "calendly_popup",
      cta_location: lastCalendlyCtaLocation
    });
  }
});

// Live demo click
document
  .querySelectorAll(
    'a[href*="landscapingdemo.hicksanalytics.com"], a[href*="hvacdemo.hicksanalytics.com"]'
  )
  .forEach((link) => {
    link.addEventListener("click", () => {
      captureAnalytics("demo_clicked", {
        destination: link.href
      });
    });
  });

// GitHub project click
document
  .querySelectorAll(
    'a[href*="github.com/hicksanalytics/hicks-landscaping-analytics"], a[href*="github.com/hicksanalytics/hicks-hvac-analytics"]'
  )
  .forEach((link) => {
    link.addEventListener("click", () => {
      captureAnalytics("project_github_clicked", {
        project: link.href.includes("hicks-hvac-analytics") ? "hvac" : "landscaping"
      });
    });
  });

// Contact form engagement
const trackedContactForm = document.querySelector("#contact-form");

if (trackedContactForm) {
  trackedContactForm.addEventListener(
    "focusin",
    () => captureOncePerSession("contact_form_started"),
    { once: true }
  );
}

// Scroll depth
const scrollThresholds = [50, 75];
const seenScrollThresholds = new Set();

function trackScrollDepth() {
  const maxScrollable =
    document.documentElement.scrollHeight -
    window.innerHeight;

  if (maxScrollable <= 0) return;

  const percent =
    Math.round((window.scrollY / maxScrollable) * 100);

  scrollThresholds.forEach((threshold) => {
    if (
      percent >= threshold &&
      !seenScrollThresholds.has(threshold)
    ) {
      seenScrollThresholds.add(threshold);

      captureOncePerSession(
        `scroll_${threshold}`,
        { scroll_percent: threshold }
      );
    }
  });
}

window.addEventListener(
  "scroll",
  trackScrollDepth,
  { passive: true }
);

const revealObserver = new IntersectionObserver(
  (entries) => entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    }
  }),
  { threshold: 0.12 }
);

document.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));

const contactForm = document.querySelector("#contact-form");
const formStatus = document.querySelector("#form-status");
const submitButton = contactForm?.querySelector('button[type="submit"]');

if (contactForm && formStatus && submitButton) contactForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const defaultLabel = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "Sending...";
  formStatus.textContent = "Sending your message...";
  formStatus.classList.remove("form-success", "form-error");

  try {
    const response = await fetch(contactForm.action, {
      method: "POST",
      body: new FormData(contactForm),
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error("Form submission failed");
    }

    contactForm.reset();
    formStatus.textContent = "Thanks — your message was sent. I’ll be in touch soon.";
    formStatus.classList.add("form-success");
    captureAnalytics("contact_form_submitted");
  } catch (error) {
    formStatus.textContent = "Something went wrong. Please email hicksanalytics@outlook.com or try again.";
    formStatus.classList.add("form-error");
    captureAnalytics("contact_form_error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = defaultLabel;
  }
});
