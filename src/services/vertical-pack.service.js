/* ─── Vertical Pack Service ────────────────────────────────────────────────
 *  Market-fit presets that apply proven configuration defaults per industry.
 * ─────────────────────────────────────────────────────────────────────────── */

const { DEFAULT_CONFIG } = require("../config/default-config");

const VERTICAL_PACKS = {
  real_estate: {
    id: "real_estate",
    name: "Real Estate",
    description: "Buyer/renter qualification, visit booking, and ROI-driven follow-ups.",
    patch: {
      AI_CLOSING_FLOW: "consultative",
      AI_CLOSE_QUESTION_MODE: "warm_hot",
      AI_QUALIFICATION_FIELDS: "need,budget,timeline,decision-maker,location,property-type",
      AI_FOLLOW_UP_ENABLED: "true",
      AI_FOLLOW_UP_DELAY_MINUTES: "120",
      AI_FOLLOW_UP_MAX_ATTEMPTS: "4",
      AI_FOLLOW_UP_TEMPLATE:
        "Quick follow-up: would you like me to share the best options in your preferred area and budget?",
      AI_PRODUCT_KNOWLEDGE:
        "We help buyers and renters shortlist high-fit properties by budget, location, and timeline. We provide transparent details, fast scheduling, and guided next steps.",
      AI_OBJECTION_PLAYBOOK:
        "Price objection: compare monthly value and appreciation potential.\nTiming objection: offer shortlist now + visit later.\nTrust objection: share proof, location insights, and transparent process.",
    },
  },
  dental_clinic: {
    id: "dental_clinic",
    name: "Dental Clinic",
    description: "High-conversion treatment inquiries and appointment confirmations.",
    patch: {
      AI_CLOSING_FLOW: "balanced",
      AI_CLOSE_QUESTION_MODE: "warm_hot",
      AI_QUALIFICATION_FIELDS: "need,budget,timeline,decision-maker,pain-level,preferred-time",
      AI_FOLLOW_UP_ENABLED: "true",
      AI_FOLLOW_UP_DELAY_MINUTES: "90",
      AI_FOLLOW_UP_MAX_ATTEMPTS: "3",
      AI_FOLLOW_UP_TEMPLATE:
        "Thanks for checking in. Would you like us to reserve a consultation slot this week?",
      AI_PRODUCT_KNOWLEDGE:
        "We provide dental consultations and treatment plans with clear pricing and appointment options. We focus on comfort, transparent communication, and fast scheduling.",
      AI_OBJECTION_PLAYBOOK:
        "Price objection: explain treatment value, outcomes, and payment options.\nFear objection: reassure with comfort-focused process and clear steps.\nTiming objection: propose short consult slot first.",
    },
  },
  auto_dealer: {
    id: "auto_dealer",
    name: "Auto Dealer",
    description: "Vehicle inquiry qualification, test-drive booking, and close-ready messaging.",
    patch: {
      AI_CLOSING_FLOW: "direct",
      AI_CLOSE_QUESTION_MODE: "always",
      AI_QUALIFICATION_FIELDS: "need,budget,timeline,decision-maker,model,financing",
      AI_FOLLOW_UP_ENABLED: "true",
      AI_FOLLOW_UP_DELAY_MINUTES: "180",
      AI_FOLLOW_UP_MAX_ATTEMPTS: "4",
      AI_FOLLOW_UP_TEMPLATE:
        "Would you like me to reserve a quick test-drive slot and share the best finance option?",
      AI_PRODUCT_KNOWLEDGE:
        "We help customers choose the right vehicle based on budget, usage, and financing preference. We provide clear specs, transparent offers, and quick test-drive scheduling.",
      AI_OBJECTION_PLAYBOOK:
        "Price objection: compare total ownership value + financing flexibility.\nNeed objection: map model features to daily usage.\nTiming objection: offer no-pressure test drive first.",
    },
  },
  education: {
    id: "education",
    name: "Education / Training",
    description: "Enroll more students through structured qualification and reminder flows.",
    patch: {
      AI_CLOSING_FLOW: "consultative",
      AI_CLOSE_QUESTION_MODE: "warm_hot",
      AI_QUALIFICATION_FIELDS: "need,budget,timeline,decision-maker,course-interest,current-level",
      AI_FOLLOW_UP_ENABLED: "true",
      AI_FOLLOW_UP_DELAY_MINUTES: "240",
      AI_FOLLOW_UP_MAX_ATTEMPTS: "5",
      AI_FOLLOW_UP_TEMPLATE:
        "Can I help you compare the best course option and start date for your goal?",
      AI_PRODUCT_KNOWLEDGE:
        "We guide learners to the best-fit course based on goals, current level, and timeline. We offer structured support, clear enrollment steps, and practical outcomes.",
      AI_OBJECTION_PLAYBOOK:
        "Price objection: frame investment vs career/skill outcomes.\nNeed objection: align module outcomes with learner goals.\nTiming objection: suggest next available batch and roadmap.",
    },
  },
  ecommerce: {
    id: "ecommerce",
    name: "E-commerce",
    description: "Recover abandoned chats/carts and convert intent into orders.",
    patch: {
      AI_CLOSING_FLOW: "direct",
      AI_CLOSE_QUESTION_MODE: "warm_hot",
      AI_QUALIFICATION_FIELDS: "need,budget,timeline,decision-maker,product,quantity",
      AI_FOLLOW_UP_ENABLED: "true",
      AI_FOLLOW_UP_DELAY_MINUTES: "60",
      AI_FOLLOW_UP_MAX_ATTEMPTS: "3",
      AI_FOLLOW_UP_TEMPLATE:
        "Want me to help you complete the order now and confirm delivery details?",
      AI_PRODUCT_KNOWLEDGE:
        "We help customers choose the right product variant quickly, confirm availability, and complete orders with clear delivery and payment details.",
      AI_OBJECTION_PLAYBOOK:
        "Price objection: highlight value bundle or limited offer.\nTrust objection: provide return/replacement confidence.\nTiming objection: share delivery ETA and simple checkout.",
    },
  },
};

function listVerticalPacks() {
  return Object.values(VERTICAL_PACKS).map((pack) => ({
    id: pack.id,
    name: pack.name,
    description: pack.description,
  }));
}

function applyVerticalPack(workspace, packId) {
  const pack = VERTICAL_PACKS[String(packId || "").trim()];
  if (!pack) throw new Error("Unknown vertical pack");

  if (!workspace.config) {
    workspace.config = { ...DEFAULT_CONFIG };
  }

  workspace.config = {
    ...workspace.config,
    ...pack.patch,
  };

  return {
    pack: {
      id: pack.id,
      name: pack.name,
      description: pack.description,
    },
    config: workspace.config,
  };
}

module.exports = {
  listVerticalPacks,
  applyVerticalPack,
};
