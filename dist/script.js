const navToggle = document.querySelector(".nav-toggle");
const nav = document.querySelector(".primary-nav");

function closeMenu() {
  nav.classList.remove("open");
  navToggle.setAttribute("aria-expanded", "false");
  document.body.classList.remove("menu-open");
}

navToggle.addEventListener("click", () => {
  const isOpen = nav.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
  document.body.classList.toggle("menu-open", isOpen);
});

nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));

document.querySelector("#year").textContent = new Date().getFullYear();

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
const submitButton = contactForm.querySelector('button[type="submit"]');

contactForm.addEventListener("submit", async (event) => {
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
  } catch (error) {
    formStatus.textContent = "Something went wrong. Please email hicksanalytics@outlook.com or try again.";
    formStatus.classList.add("form-error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = defaultLabel;
  }
});
