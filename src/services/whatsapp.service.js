/* ─── WhatsApp Service ─────────────────────────────────────────────────────
 *  Client lifecycle, schedulers & probes, bulk messaging,
 *  incoming-message handler, and scheduled-message processing.
 * ─────────────────────────────────────────────────────────────────────────── */

const os = require("os");
const cron = require("node-cron");
const QRCode = require("qrcode");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const { DEFAULT_CONFIG } = require("../config/default-config");
const { BOOKING_ENABLED, BOOKING_TIMEZONE, SERVER_STARTED_AT, DATA_DIR } = require("../config/env");
const {
  sanitizeText,
  sanitizeMultilineText,
  sanitizeChoice,
  sanitizeIntegerString,
} = require("../utils/workspace-config");
const { sleep, parseList, parseTemplateLines, parseAutoReplyRules, fetchWithRetry } = require("../utils/helpers");
const {
  store,
  saveStore,
  getRuntime,
  appendReport,
  workspaceRecipientsChatIds,
  ensureWorkspaceBookings,
  initBookingRecord,
  bookingTimezone,
} = require("../models/store");
const { incrementUsage } = require("./plan.service");
const {
  resolveChromeExecutablePath,
  clearStaleProfileLocks,
  ensureChromeExecutablePath,
} = require("./chrome.service");
const {
  parseAiJsonResponse,
  normalizeAiDecision,
  scoreLeadDecision,
  deriveLeadStage,
  buildSalesReplyFromDecision,
  postLeadSeekingStatus,
} = require("./ai.service");
const { updateLeadStatus, nextFollowUpAt } = require("./lead.service");
const { queueAlert } = require("./whatsapp-alerts.service");
const {
  bookingIntentFromText,
  bookingLeadName,
  formatSlotForHumans,
  sendBookingIntentOptions,
  createCalendarBookingEvent,
} = require("./booking.service");
const { resolveMediaPath } = require("./media.service");
const {
  getConversationHistory,
  pushToConversationHistory,
  formatHistoryForPrompt,
} = require("./conversation-memory");
const { getObjectionRebuttal } = require("./objection.service");
const { isOptimalSendTime } = require("./timezone.service");
const { recordReply } = require("./ab-testing.service");
const { computeOffer, buildOfferMessage, logOffer } = require("./offer-authority.service");

// ─── Bulk-send helpers ─────────────────────────────────────────────────────
function getBulkOptions(config, overrides = {}) {
  const pick = (v, fb) =>
    v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? fb : v;

  const mode = sanitizeChoice(
    sanitizeText(pick(overrides.mode, config.BULK_SEND_MODE), DEFAULT_CONFIG.BULK_SEND_MODE),
    ["instant", "staggered", "random"],
    DEFAULT_CONFIG.BULK_SEND_MODE
  );
  const delayMs = Number(
    sanitizeIntegerString(pick(overrides.delayMs, config.BULK_DELAY_MS), DEFAULT_CONFIG.BULK_DELAY_MS, 100, 60000)
  );
  const randomMinMs = Number(
    sanitizeIntegerString(
      pick(overrides.randomMinMs, config.BULK_RANDOM_MIN_MS),
      DEFAULT_CONFIG.BULK_RANDOM_MIN_MS,
      100,
      60000
    )
  );
  const randomMaxMs = Number(
    sanitizeIntegerString(
      pick(overrides.randomMaxMs, config.BULK_RANDOM_MAX_MS),
      DEFAULT_CONFIG.BULK_RANDOM_MAX_MS,
      100,
      120000
    )
  );
  const templateMode = sanitizeChoice(
    sanitizeText(
      pick(overrides.templateMode, config.BULK_TEMPLATE_MODE),
      DEFAULT_CONFIG.BULK_TEMPLATE_MODE
    ),
    ["single", "rotate", "random"],
    DEFAULT_CONFIG.BULK_TEMPLATE_MODE
  );
  const templateLines = parseTemplateLines(
    sanitizeMultilineText(
      pick(overrides.templateLines, config.BULK_TEMPLATE_LINES),
      DEFAULT_CONFIG.BULK_TEMPLATE_LINES
    )
  );
  return {
    mode,
    delayMs,
    randomMinMs: Math.min(randomMinMs, randomMaxMs),
    randomMaxMs: Math.max(randomMinMs, randomMaxMs),
    templateMode,
    templateLines,
  };
}

function pickMessage(index, baseMessage, options) {
  const templates = options.templateLines.length > 0 ? options.templateLines : [baseMessage];
  if (options.templateMode === "rotate") return templates[index % templates.length];
  if (options.templateMode === "random")
    return templates[Math.floor(Math.random() * templates.length)];
  return baseMessage;
}

function getInterMessageDelay(options) {
  if (options.mode === "staggered") return options.delayMs;
  if (options.mode === "random") {
    const delta = options.randomMaxMs - options.randomMinMs;
    return options.randomMinMs + Math.floor(Math.random() * (delta + 1));
  }
  return 0;
}

// ─── Scheduler helpers ─────────────────────────────────────────────────────
function stopScheduler(runtime) {
  if (runtime.scheduler) {
    runtime.scheduler.stop();
    runtime.scheduler.destroy();
    runtime.scheduler = null;
  }
  if (runtime.statusScheduler) {
    runtime.statusScheduler.stop();
    runtime.statusScheduler.destroy();
    runtime.statusScheduler = null;
  }
}

function setupScheduler(workspace, runtime) {
  if (runtime.scheduler) {
    runtime.scheduler.stop();
    runtime.scheduler.destroy();
    runtime.scheduler = null;
  }
  if (workspace.config.SCHEDULE_ENABLED !== "true") return;
  const expression = workspace.config.SCHEDULE_CRON || DEFAULT_CONFIG.SCHEDULE_CRON;
  if (!cron.validate(expression)) {
    runtime.lastError = `Invalid cron expression: ${expression}`;
    return;
  }
  runtime.scheduler = cron.schedule(expression, async () => {
    try {
      await sendBulkMessage(
        workspace,
        runtime,
        workspace.config.SCHEDULE_MESSAGE || DEFAULT_CONFIG.SCHEDULE_MESSAGE,
        { source: "scheduled" }
      );
    } catch (err) {
      runtime.lastError = err.message;
    }
  });
}

function setupStatusScheduler(workspace, runtime) {
  if (runtime.statusScheduler) {
    runtime.statusScheduler.stop();
    runtime.statusScheduler.destroy();
    runtime.statusScheduler = null;
  }
  if (workspace.config.AI_STATUS_AUTOPILOT_ENABLED !== "true") return;
  const expression =
    workspace.config.AI_STATUS_AUTOPILOT_CRON || DEFAULT_CONFIG.AI_STATUS_AUTOPILOT_CRON;
  if (!cron.validate(expression)) {
    runtime.lastError = `Invalid AI status cron expression: ${expression}`;
    return;
  }
  runtime.statusScheduler = cron.schedule(expression, async () => {
    try {
      await postLeadSeekingStatus(workspace, runtime, "status_autopilot");
    } catch (err) {
      runtime.lastError = `Auto status failed: ${err.message}`;
      appendReport(workspace, {
        kind: "auto_status",
        source: "status_autopilot",
        ok: false,
        error: err.message,
      });
    }
  });
}

function markWorkspaceReady(workspace, runtime) {
  if (runtime.ready) return;
  runtime.status = "ready";
  runtime.ready = true;
  runtime.startRequestedAt = null;
  runtime.qrDataUrl = "";
  setupScheduler(workspace, runtime);
  setupStatusScheduler(workspace, runtime);
}

// ─── Ready probe & recovery ────────────────────────────────────────────────
function stopReadyProbe(runtime) {
  if (runtime.readyProbeTimer) {
    clearInterval(runtime.readyProbeTimer);
    runtime.readyProbeTimer = null;
  }
}

async function restartClientBridge(workspace, runtime, reason) {
  if (runtime.recoveryInProgress) return;
  runtime.recoveryInProgress = true;
  runtime.lastError = reason;
  runtime.status = "restarting_bridge";
  stopReadyProbe(runtime);
  try {
    if (runtime.client) {
      await runtime.client.destroy();
      runtime.client = null;
    }
  } catch (_err) {
    runtime.client = null;
  }
  runtime.ready = false;
  runtime.authenticated = false;
  runtime.startRequestedAt = Date.now();
  try {
    await createClientForWorkspace(workspace);
  } finally {
    runtime.recoveryInProgress = false;
  }
}

async function waitForConnected(runtime, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!runtime.client) return false;
    try {
      const state = await runtime.client.getState();
      runtime.lastWaState = state || "";
      if (state === "CONNECTED") return true;
    } catch (_err) {
      /* transient */
    }
    await sleep(1000);
  }
  return false;
}

async function ensureSendableConnection(workspace, runtime) {
  if (!runtime.client) throw new Error("WhatsApp client is not running.");
  if (runtime.ready) return;

  const sendWaitMs = Math.max(
    15000,
    Number.parseInt(process.env.WA_SEND_WAIT_MS || "120000", 10) || 120000
  );
  const restartLimit = Math.max(
    0,
    Number.parseInt(process.env.WA_SEND_RESTART_LIMIT || "2", 10) || 2
  );
  const startedAt = Date.now();
  let restarts = 0;

  while (Date.now() - startedAt < sendWaitMs) {
    if (!runtime.client) break;
    if (runtime.ready) return;
    const connected = await waitForConnected(runtime, 5000);
    if (connected) {
      markWorkspaceReady(workspace, runtime);
      return;
    }
    if (runtime.authenticated && restarts < restartLimit && !runtime.recoveryInProgress) {
      restarts += 1;
      await restartClientBridge(
        workspace,
        runtime,
        `Authenticated but not connected for send attempt. Restarting bridge (${restarts}/${restartLimit}).`
      );
      continue;
    }
    await sleep(1500);
  }
  throw new Error(
    "WhatsApp is authenticated but not connected yet. Keep client running and try send again in a moment."
  );
}

function startReadyProbe(workspace, runtime) {
  stopReadyProbe(runtime);
  runtime.readyProbeTimer = setInterval(async () => {
    if (!runtime.client || runtime.ready) {
      stopReadyProbe(runtime);
      return;
    }
    try {
      const state = await runtime.client.getState();
      runtime.lastWaState = state || "";
      if (state === "CONNECTED") {
        markWorkspaceReady(workspace, runtime);
        stopReadyProbe(runtime);
      }
    } catch (_err) {
      /* ignore */
    }
    const waitedMs = runtime.authenticatedAt ? Date.now() - runtime.authenticatedAt : 0;
    if (
      !runtime.ready &&
      runtime.authenticated &&
      waitedMs > 90000 &&
      !runtime.recoveryAttempted
    ) {
      runtime.recoveryAttempted = true;
      await restartClientBridge(
        workspace,
        runtime,
        "Authenticated but not ready for 90s. Restarting WhatsApp bridge once."
      );
    }
  }, 3000);
}

// ─── Conversation history sync ─────────────────────────────────────────────
function messageSerializedId(message) {
  return String(message?.id?._serialized || "");
}

async function syncConversationHistoryFromChat(workspace, runtime, msg, maxTurns) {
  try {
    if (!runtime.historySyncedContacts) runtime.historySyncedContacts = new Set();
    const contactId = String(msg.from || "");
    if (!contactId || runtime.historySyncedContacts.has(contactId)) return;

    const chat = await msg.getChat();
    const fetchLimit = Math.max(40, maxTurns * 2 + 20);
    const recentMessages = await chat.fetchMessages({ limit: fetchLimit });
    const currentMessageId = messageSerializedId(msg);
    const sorted = (recentMessages || [])
      .filter((item) => item && typeof item.body === "string" && item.body.trim())
      .filter((item) => messageSerializedId(item) !== currentMessageId)
      .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

    for (const item of sorted) {
      const role = item.fromMe ? "assistant" : "user";
      pushToConversationHistory(workspace.id, contactId, role, item.body, maxTurns);
    }
    runtime.historySyncedContacts.add(contactId);
  } catch (err) {
    console.log(`[${workspace.id}] History sync skipped: ${err.message}`);
  }
}

// ─── Bulk send ─────────────────────────────────────────────────────────────
async function sendBulkMessage(workspace, runtime, messageOrMessages, overrides = {}) {
  if (!runtime.client || (!runtime.ready && !runtime.authenticated))
    throw new Error("WhatsApp client is not connected yet.");
  if (runtime.sendInProgress)
    throw new Error("A campaign is already running for this workspace. Please wait until it finishes.");

  runtime.sendInProgress = true;
  runtime.sendStartedAt = Date.now();

  try {
    await ensureSendableConnection(workspace, runtime);
    const recipients = workspaceRecipientsChatIds(workspace);
    if (recipients.length === 0) throw new Error("No recipients configured.");

    const options = getBulkOptions(workspace.config, overrides);
    const results = [];
    const messages = Array.isArray(messageOrMessages) ? messageOrMessages : [messageOrMessages];

    for (let i = 0; i < recipients.length; i += 1) {
      const chatId = recipients[i];
      const source = sanitizeText(overrides.source, "manual");

      // Timezone-aware sending: skip recipients outside optimal hours
      if (workspace.config?.AUTO_TIMEZONE_ENABLED === "true" && !isOptimalSendTime(chatId)) {
        results.push({ chatId, ok: false, error: "Skipped: outside optimal timezone window" });
        appendReport(workspace, {
          kind: "outgoing",
          source,
          ok: false,
          chatId,
          message: "(timezone skip)",
          error: "Outside optimal send window",
        });
        continue;
      }

      for (const baseMsg of messages) {
        const outgoingMessage = pickMessage(i, baseMsg, options);
        try {
          if (overrides.mediaId) {
            const resolved = resolveMediaPath(workspace, overrides.mediaId);
            if (!resolved) throw new Error("Media not found for mediaId");
            const media = MessageMedia.fromFilePath(resolved.absPath);
            await runtime.client.sendMessage(chatId, media, {
              caption: outgoingMessage || undefined,
            });
          } else {
            await runtime.client.sendMessage(chatId, outgoingMessage);
          }
          results.push({ chatId, ok: true, mode: options.mode });
          incrementUsage(workspace, "messagesSent");
          appendReport(workspace, {
            kind: "outgoing",
            source,
            ok: true,
            mode: options.mode,
            templateMode: options.templateMode,
            chatId,
            message: outgoingMessage,
          });
        } catch (err) {
          results.push({ chatId, ok: false, error: err.message });
          appendReport(workspace, {
            kind: "outgoing",
            source,
            ok: false,
            mode: options.mode,
            templateMode: options.templateMode,
            chatId,
            message: outgoingMessage,
            error: err.message,
          });
        }
        if (messages.length > 1) await sleep(500);
      }

      const interDelayMs = getInterMessageDelay(options);
      if (interDelayMs > 0 && i < recipients.length - 1) await sleep(interDelayMs);
    }
    return results;
  } finally {
    runtime.sendInProgress = false;
    runtime.sendStartedAt = null;
  }
}

// ─── Client creation & lifecycle ───────────────────────────────────────────
async function createClientForWorkspace(workspace) {
  const runtime = getRuntime(workspace.id);
  if (runtime.client) return;

  clearStaleProfileLocks(workspace.id);

  const headless = workspace.config.HEADLESS !== "false";
  const executablePath = await ensureChromeExecutablePath(runtime);
  const isRender = process.env.RENDER === "true";
  const totalMemMb = Math.floor(os.totalmem() / (1024 * 1024));
  const lowMemoryHost = totalMemMb <= 1200;
  const forceSingleProcess = process.env.CHROME_SINGLE_PROCESS
    ? process.env.CHROME_SINGLE_PROCESS === "true"
    : lowMemoryHost;
  const disableSingleProcess = runtime._disableSingleProcess === true;
  const launchArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-software-rasterizer",
    "--disable-gpu-sandbox",
    "--disable-accelerated-2d-canvas",
    "--disable-gpu-shader-disk-cache",
    "--disable-crash-reporter",
    "--disable-features=site-per-process",
    "--disable-gl-drawing-for-tests",
  ];
  const launchTimeoutMs = Math.max(
    30000,
    Number.parseInt(process.env.PUPPETEER_LAUNCH_TIMEOUT_MS || "120000", 10) || 120000
  );
  const authTimeoutMs = Math.max(
    30000,
    Number.parseInt(process.env.WA_AUTH_TIMEOUT_MS || "120000", 10) || 120000
  );

  console.log(`[DEBUG] Attempting to launch client...`);
  console.log(`[DEBUG] CWD: ${process.cwd()}`);
  console.log(`[DEBUG] Executable Path: ${executablePath || "default"}`);
  console.log(`[DEBUG] Environment: ${process.env.NODE_ENV || "unknown"}`);
  console.log(`[DEBUG] Host RAM MB: ${totalMemMb}`);
  const actuallyUsingSingleProcess =
    !disableSingleProcess && (isRender || forceSingleProcess) && totalMemMb < 2000;
  console.log(`[DEBUG] Single-process mode: ${actuallyUsingSingleProcess ? "on" : "off"}`);
  if (runtime._forceManagedChrome) console.log("[DEBUG] Managed Chrome fallback mode: on");

  if (actuallyUsingSingleProcess) {
    launchArgs.push("--no-zygote", "--single-process");
  } else {
    console.log(
      `[DEBUG] Running without --single-process (RAM ${totalMemMb}MB${disableSingleProcess ? ", crash fallback forced" : ""}).`
    );
  }
  if (process.env.CHROME_DISABLE_SITE_ISOLATION === "true") {
    launchArgs.push("--disable-features=IsolateOrigins,site-per-process");
  }

  runtime.client = new Client({
    authStrategy: new LocalAuth({ clientId: `workspace-${workspace.id}` }),
    authTimeoutMs,
    puppeteer: {
      headless,
      args: launchArgs,
      executablePath: executablePath || undefined,
      timeout: launchTimeoutMs,
      protocolTimeout: launchTimeoutMs,
    },
  });
  console.log(`[DEBUG] Executable being used: ${executablePath || "default (puppeteer)"}`);

  // ── QR ──
  runtime.client.on("qr", async (qr) => {
    runtime.status = "qr_ready";
    runtime.ready = false;
    try {
      runtime.qrDataUrl = await QRCode.toDataURL(qr);
    } catch (err) {
      runtime.lastError = `QR render failed: ${err.message}`;
    }
  });

  // ── Authenticated ──
  runtime.client.on("authenticated", () => {
    console.log(`[${workspace.id}] WhatsApp Client AUTHENTICATED`);
    runtime.authenticated = true;
    runtime.status = "authenticated";
    runtime.authenticatedAt = Date.now();
    runtime.recoveryAttempted = false;
    runtime._retryAfterSharedLibFallback = false;
    runtime._forceSystemChrome = false;
    runtime._forceManagedChrome = false;
    runtime._disableSingleProcess = false;
    runtime._failingChromePaths = [];
    runtime.qrDataUrl = "";
    startReadyProbe(workspace, runtime);
  });

  // ── State changes ──
  runtime.client.on("change_state", (state) => {
    runtime.lastWaState = state || "";
    if (state === "CONNECTED") {
      markWorkspaceReady(workspace, runtime);
      stopReadyProbe(runtime);
    }
  });

  // ── Ready ──
  runtime.client.on("ready", () => {
    console.log(`[${workspace.id}] WhatsApp Client READY`);
    markWorkspaceReady(workspace, runtime);
    runtime.recoveryAttempted = false;
    runtime._retryAfterSharedLibFallback = false;
    runtime._forceSystemChrome = false;
    runtime._forceManagedChrome = false;
    runtime._disableSingleProcess = false;
    runtime._failingChromePaths = [];
    stopReadyProbe(runtime);
  });

  // ── Incoming message handler ──
  runtime.client.on("message", async (msg) => {
    await handleIncomingMessage(workspace, runtime, msg);
  });

  // ── Auth failure ──
  runtime.client.on("auth_failure", (message) => {
    runtime.lastError = `Auth failure: ${message}`;
    runtime.status = "error";
  });

  // ── Disconnected ──
  runtime.client.on("disconnected", (reason) => {
    runtime.status = `disconnected: ${reason}`;
    runtime.ready = false;
    runtime.authenticated = false;
    runtime.startRequestedAt = null;
    runtime.qrDataUrl = "";
    runtime.authenticatedAt = null;
    runtime.recoveryAttempted = false;
    runtime.recoveryInProgress = false;
    runtime._retryAfterSharedLibFallback = false;
    runtime._forceSystemChrome = false;
    runtime._forceManagedChrome = false;
    runtime._disableSingleProcess = false;
    runtime._failingChromePaths = [];
    stopReadyProbe(runtime);
    stopScheduler(runtime);
    runtime.client = null;
  });

  // ── Initialize with fallback retry logic ──
  runtime.client.initialize().catch((err) => {
    const message = String(err?.message || "");
    const isBinaryError =
      message.includes("error while loading shared libraries") ||
      message.includes("Target.setAutoAttach") ||
      message.includes("Target closed") ||
      message.includes("Protocol error");

    if (isBinaryError && !runtime._retryAfterSharedLibFallback) {
      console.log(
        `[DEBUG] Triggering stability fallback for workspace ${workspace.id} (Error: ${message})`
      );
      const failedPath = resolveChromeExecutablePath({
        includeSystem: true,
        preferSystem: true,
        ignoreEnv: runtime._forceSystemChrome || runtime._forceManagedChrome,
      });
      runtime._failingChromePaths = runtime._failingChromePaths || [];
      if (failedPath) {
        runtime._failingChromePaths.push(failedPath);
        if (failedPath.includes("google-chrome")) {
          runtime._failingChromePaths.push("/usr/bin/google-chrome");
          runtime._failingChromePaths.push("/usr/bin/google-chrome-stable");
        }
      }
      const configuredEnvPath = String(process.env.PUPPETEER_EXECUTABLE_PATH || "").trim();
      if (configuredEnvPath) {
        runtime._failingChromePaths.push(configuredEnvPath);
        if (configuredEnvPath.includes("chromium-browser"))
          runtime._failingChromePaths.push("/usr/bin/chromium");
      }
      console.log(`[DEBUG] Wiping stale locks for fallback attempt...`);
      clearStaleProfileLocks(workspace.id);
      runtime._retryAfterSharedLibFallback = true;
      runtime._forceSystemChrome = false;
      runtime._forceManagedChrome = true;
      runtime._disableSingleProcess = true;
      runtime.client = null;
      createClientForWorkspace(workspace).catch((innerErr) => {
        console.error(
          `[DEBUG] Fallback launch FAILED for workspace ${workspace.id}: ${innerErr.message}`
        );
        runtime.lastError = `Initialize failed: ${innerErr.message}`;
        runtime.status = "error";
        runtime.ready = false;
        runtime.authenticated = false;
        runtime.startRequestedAt = null;
        runtime.authenticatedAt = null;
        runtime.client = null;
      });
      return;
    }
    runtime._retryAfterSharedLibFallback = false;
    runtime._forceSystemChrome = false;
    runtime._forceManagedChrome = false;
    runtime._disableSingleProcess = false;

    if (message.includes("The browser is already running for") && !runtime._retryAfterLockCleanup) {
      runtime._retryAfterLockCleanup = true;
      clearStaleProfileLocks(workspace.id);
      runtime.client = null;
      createClientForWorkspace(workspace).catch((innerErr) => {
        runtime.lastError = `Initialize failed: ${innerErr.message}`;
        runtime.status = "error";
        runtime.ready = false;
        runtime.authenticated = false;
        runtime.startRequestedAt = null;
        runtime.client = null;
      });
      return;
    }
    runtime._retryAfterLockCleanup = false;
    console.error(`[ERROR] workspace ${workspace.id} initialization failed: ${message}`);
    if (err.stack) console.error(err.stack);

    runtime.lastError = `Initialize failed: ${err.message}`;
    runtime.status = "error";
    runtime.ready = false;
    runtime.authenticated = false;
    runtime.startRequestedAt = null;
    runtime.authenticatedAt = null;
    runtime.recoveryAttempted = false;
    runtime.recoveryInProgress = false;
    stopReadyProbe(runtime);
    runtime.client = null;
  });

  startReadyProbe(workspace, runtime);
}

// ─── Incoming message handler (extracted) ──────────────────────────────────
async function handleIncomingMessage(workspace, runtime, msg) {
  console.log(`[SYSTEM] RAW MESSAGE RECEIVED from ${msg.from} in workspace ${workspace.id}`);
  console.log(`[${workspace.id}] Message content: ${msg.body}`);
  const fromId = String(msg.from || "");
  const toId = String(msg.to || "");
  const isStatusMessage =
    msg.isStatus === true ||
    fromId === "status@broadcast" ||
    toId === "status@broadcast" ||
    fromId.endsWith("@broadcast");
  const isChannelMessage = fromId.endsWith("@newsletter");

  if (isStatusMessage || isChannelMessage) {
    console.log(`[${workspace.id}] Ignoring status/channel message from ${fromId || "unknown"}.`);
    return;
  }

  // ── Booking intent handling ──
  if (BOOKING_ENABLED && !msg.fromMe) {
    ensureWorkspaceBookings(workspace);
    const leadId = String(msg.from || "");
    const leadName = bookingLeadName(leadId, workspace, "there");
    const incomingRaw = sanitizeText(msg.body, "");
    const timezone = BOOKING_TIMEZONE;
    const offerState = runtime.bookingOfferByLeadId.get(leadId) || null;
    const selectedSlotMatch = incomingRaw.match(/^\s*([1-9])\s*$/);

    if (offerState && selectedSlotMatch) {
      const selectedIndex = Number.parseInt(selectedSlotMatch[1], 10) - 1;
      const selectedSlot = offerState.slots?.[selectedIndex];
      if (selectedSlot) {
        try {
          const event = await createCalendarBookingEvent({
            leadName,
            leadId,
            startAt: selectedSlot.startAt,
            endAt: selectedSlot.endAt,
            notes: "Auto-booked from WhatsApp slot selection.",
            timezone,
          });
          const booking = initBookingRecord({
            leadId,
            leadName,
            timezone,
            status: "confirmed",
            startAt: selectedSlot.startAt,
            endAt: selectedSlot.endAt,
            calendarEventId: sanitizeText(event.id, ""),
            meetingLink: sanitizeText(event.hangoutLink, ""),
            notes: "Auto-booked from chat",
          });
          workspace.bookings.push(booking);
          updateLeadStatus(workspace, {
            from: leadId,
            stage: "booking",
            reason: "Booking confirmed from slot selection",
          });
          saveStore();
          runtime.bookingOfferByLeadId.delete(leadId);
          const confirmedWhen = formatSlotForHumans(booking.startAt, booking.timezone);
          const meetLine = booking.meetingLink ? `\nMeeting link: ${booking.meetingLink}` : "";
          await runtime.client.sendMessage(
            leadId,
            `Booked. Your call is confirmed for ${confirmedWhen}.${meetLine}`.trim()
          );
          appendReport(workspace, {
            kind: "booking_confirmed",
            source: "booking_autopilot",
            ok: true,
            from: leadId,
            bookingId: booking.id,
            message: `Booked slot ${confirmedWhen}`,
          });
          queueAlert(workspace.id, "booking_confirmed", {
            leadName: booking.leadName || leadId.split("@")[0],
            leadId,
            bookingTime: confirmedWhen,
            reason: booking.meetingLink ? `Meeting: ${booking.meetingLink}` : "Calendar event created",
          });
          return;
        } catch (err) {
          runtime.lastError = `Auto-book failed: ${err.message}`;
          await runtime.client.sendMessage(
            leadId,
            "I couldn't auto-confirm that slot right now. Please send your preferred date/time and we will confirm manually."
          );
        }
      }
    }

    if (bookingIntentFromText(incomingRaw)) {
      try {
        const sent = await sendBookingIntentOptions(workspace, runtime, leadId, leadName, timezone);
        if (sent.slots.length > 0) {
          runtime.bookingOfferByLeadId.set(leadId, {
            slots: sent.slots,
            createdAt: new Date().toISOString(),
          });
        }
        appendReport(workspace, {
          kind: "booking_intent",
          source: "booking_autopilot",
          ok: true,
          from: leadId,
          message: incomingRaw,
          mode: sent.reason,
        });
        if (sent.sent) return;
      } catch (err) {
        runtime.lastError = `Booking intent failed: ${err.message}`;
      }
    }
  }

  // ── Auto-reply / AI ──
  if (workspace.config.AUTO_REPLY_ENABLED !== "true") {
    console.log(`[${workspace.id}] Auto-reply disabled, ignoring message.`);
    return;
  }

  const incomingText = (msg.body || "").trim().toLowerCase();
  const mode = workspace.config.AUTO_REPLY_MODE || DEFAULT_CONFIG.AUTO_REPLY_MODE;
  const trigger = (
    workspace.config.AUTO_REPLY_TRIGGER || DEFAULT_CONFIG.AUTO_REPLY_TRIGGER
  ).toLowerCase();
  let replyText = "";
  updateLeadStatus(workspace, {
    from: msg.from,
    message: msg.body,
    lastInboundAt: new Date().toISOString(),
    nextFollowUpAt: "",
  });

  // Track A/B test replies
  recordReply(workspace, msg.from);

  // ── Objection recovery (intercepts before AI/auto-reply) ──
  const objectionRebuttal = getObjectionRebuttal(workspace, msg.body);

  if (mode === "exact" && incomingText === trigger)
    replyText = workspace.config.AUTO_REPLY_TEXT || DEFAULT_CONFIG.AUTO_REPLY_TEXT;
  if (mode === "contains" && trigger && incomingText.includes(trigger))
    replyText = workspace.config.AUTO_REPLY_TEXT || DEFAULT_CONFIG.AUTO_REPLY_TEXT;
  if (mode === "rules") {
    const rules = parseAutoReplyRules(workspace.config.AUTO_REPLY_RULES || "");
    const matched = rules.find((r) => incomingText.includes(r.trigger));
    if (matched) replyText = matched.response;
  }

  // If objection was detected and no rule matched, use the rebuttal
  if (!replyText && objectionRebuttal) {
    replyText = objectionRebuttal;
    appendReport(workspace, {
      kind: "objection_rebuttal",
      source: "objection_autopilot",
      ok: true,
      from: msg.from,
      incoming: incomingText,
      message: objectionRebuttal,
    });
  }

  if (!replyText || workspace.config.AI_SALES_SCOPE === "all") {
    const isGroup = msg.from.endsWith("@g.us");
    const allowAi =
      workspace.config.AI_SALES_ENABLED === "true" && workspace.config.AI_API_KEY;
    const aiGroups = workspace.config.AI_SALES_GROUPS === "true";

    // ── Human takeover check ──
    const takeover = getHumanTakeover(workspace, msg.from);
    if (takeover) {
      // AI is paused for this contact — just log the incoming message for the human agent
      pushLiveChatMessage(workspace, msg.from, "in", msg.body || "");
      console.log(`[${workspace.id}] Human takeover active for ${msg.from} — AI skipped.`);
      return; // Do NOT reply with AI
    }

    if (allowAi && !(isGroup && !aiGroups)) {
      console.log(
        `[${workspace.id}] AI Sales Closer active. (Server: ${SERVER_STARTED_AT})`
      );
      let contactName = "";
      try {
        const apiKey = workspace.config.AI_API_KEY;
        const modelName = workspace.config.AI_MODEL || "gemini-1.5-flash";
        const provider = workspace.config.AI_PROVIDER || "google";
        console.log(`[${workspace.id}] Using AI Provider: ${provider}, Model: ${modelName}`);

        const knowledge = (workspace.config.AI_PRODUCT_KNOWLEDGE || "").replace(
          /^["']|["']$/g,
          ""
        );
        const bookingEnabled = workspace.config.AI_BOOKING_ENABLED === "true";
        const bookingLink = workspace.config.AI_BOOKING_LINK || "";
        const maxTurns =
          parseInt(workspace.config.AI_MEMORY_TURNS || "10", 10) || 10;
        const qualificationEnabled = workspace.config.AI_QUALIFICATION_ENABLED !== "false";
        const qualificationFields = parseList(
          workspace.config.AI_QUALIFICATION_FIELDS || DEFAULT_CONFIG.AI_QUALIFICATION_FIELDS
        );
        const closingFlow = sanitizeChoice(
          workspace.config.AI_CLOSING_FLOW,
          ["balanced", "direct", "consultative"],
          DEFAULT_CONFIG.AI_CLOSING_FLOW
        );
        const objectionPlaybook = sanitizeText(workspace.config.AI_OBJECTION_PLAYBOOK, "");
        const includeStatusFeatures =
          workspace.config.AI_WHATSAPP_STATUS_FEATURES === "true";
        const statusFeaturesText = sanitizeText(
          workspace.config.AI_WHATSAPP_STATUS_FEATURES_TEXT,
          DEFAULT_CONFIG.AI_WHATSAPP_STATUS_FEATURES_TEXT
        );

        await syncConversationHistoryFromChat(workspace, runtime, msg, maxTurns);

        contactName = "";
        try {
          const contact = await msg.getContact();
          contactName = contact.pushname || contact.name || contact.number || "";
        } catch (ce) {
          console.log(`[${workspace.id}] Could not get contact name: ${ce.message}`);
        }

        const history = getConversationHistory(workspace.id, msg.from);
        const historyBlock = formatHistoryForPrompt(history);
        const closingFlowInstruction =
          closingFlow === "direct"
            ? "Use a direct close: summarize value quickly, then ask for a concrete next step."
            : closingFlow === "consultative"
              ? "Use a consultative close: verify fit, solve objections, and offer a no-pressure next step."
              : "Use a balanced close: discovery first, value summary, then a clear next action.";

        const prompt = `
          Context: You are a sales assistant for this product: ${knowledge}
          Objective: Answer the lead's question and guide them toward a purchase.
          ${contactName ? `Lead's Name: ${contactName} — Always greet them by name when starting a reply.` : ""}
          ${bookingEnabled && bookingLink ? `Call Booking: If the customer is interested or ready to talk, encourage them to book a call here: ${bookingLink}` : ""}
          ${qualificationEnabled ? `Qualification required: capture these fields when possible: ${qualificationFields.join(", ") || "need, budget, timeline, decision-maker"}.` : ""}
          Closing flow: ${closingFlowInstruction}
          ${includeStatusFeatures && statusFeaturesText ? `Mention this when relevant in offer positioning: ${statusFeaturesText}` : ""}
          ${objectionPlaybook ? `Objection playbook to use when relevant:\n${objectionPlaybook}` : ""}
          ${historyBlock ? `\n${historyBlock}` : ""}
          TASK:
          1. Detect the customer's language and reply in that same language.
          2. Generate a natural, personalized reply (1-3 sentences max). Use the lead's name naturally when appropriate.
          3. If the message is ambiguous, missing key details, or you're unsure, ask ONE clear clarification question instead of guessing.
          4. Keep clarification short, human, and in the customer's language.
          5. Never claim certainty when uncertain.
          6. Evaluate the lead status based on intent (cold, warm, hot) and provide a brief reason.
          7. Include a close question when there is sufficient buying intent.
          8. Keep every output practical and conversion-oriented.
          IMPORTANT: If there is conversation history above, DO NOT repeat greetings or information you already shared. Continue the conversation naturally.

          CURRENT LEAD MESSAGE: "${msg.body}"

          RESPONSE FORMAT (JSON ONLY):
          {
            "reply": "Your response text here",
            "status": "cold" | "warm" | "hot",
            "reason": "Brief explanation of status",
            "language": "detected language name (e.g. English, Hindi, Spanish)",
            "needs_clarification": true | false,
            "clarification_question": "Only required when needs_clarification is true",
            "stage": "new" | "qualified" | "proposal" | "booking" | "closed_won" | "closed_lost",
            "intent_score": 0-100,
            "close_question": "One specific closing question",
            "primary_objection": "Main objection if present, else empty",
            "qualification": {
              "need": "short value",
              "budget": "short value",
              "timeline": "short value",
              "decision_maker": "short value"
            },
            "missing_fields": ["need", "budget", "timeline", "decision_maker"]
          }
        `;

        let normalized = null;
        let rawContent = "";

        if (provider === "google") {
          const genAI = new GoogleGenerativeAI(apiKey);
          const model = genAI.getGenerativeModel({ model: modelName });
          console.log(`[${workspace.id}] Google AI Request started...`);
          const result = await model.generateContent(prompt);
          rawContent = result.response.text().trim();
          console.log(`[${workspace.id}] Google AI Raw Response: ${rawContent}`);
          incrementUsage(workspace, "aiCalls");
        } else if (provider === "openrouter") {
          console.log(`[${workspace.id}] OpenRouter AI Request started...`);
          const response = await fetchWithRetry(
            "https://openrouter.ai/api/v1/chat/completions",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://restartx.io",
                "X-Title": "RestartX WhatsApp Console",
              },
              body: JSON.stringify({
                model: modelName,
                messages: [
                  {
                    role: "system",
                    content:
                      "You are a sales assistant. IMPORTANT: You MUST respond ONLY with a valid JSON object. No extra text, no markdown, no code blocks. Just the raw JSON.",
                  },
                  { role: "user", content: prompt },
                ],
              }),
            },
            { retries: 2, timeoutMs: 30000, label: `${workspace.id}-openrouter` }
          );
          const data = await response.json();
          console.log(`[${workspace.id}] OpenRouter AI Raw Response Received`);
          if (data.error) throw new Error(data.error.message || "OpenRouter Error");
          rawContent = data?.choices?.[0]?.message?.content || "";
          incrementUsage(workspace, "aiCalls");
        }

        if (rawContent) {
          try {
            const aiData = parseAiJsonResponse(rawContent);
            normalized = normalizeAiDecision(aiData, rawContent);
            const score = scoreLeadDecision({
              status: normalized.status,
              qualification: normalized.qualification,
              needsClarification: normalized.needsClarification,
              intentScore: normalized.intentScore,
              incomingText: msg.body,
            });
            replyText =
              buildSalesReplyFromDecision(normalized, workspace.config, score) ||
              normalized.reply;
            const stage = deriveLeadStage(
              normalized.stage,
              score,
              normalized.status,
              bookingLink
            );

            pushToConversationHistory(workspace.id, msg.from, "user", msg.body, maxTurns);
            pushToConversationHistory(
              workspace.id,
              msg.from,
              "assistant",
              replyText,
              maxTurns
            );

            updateLeadStatus(workspace, {
              from: msg.from,
              name: contactName || msg.from,
              status: normalized.status,
              reason: normalized.reason,
              message: msg.body,
              stage,
              score,
              qualification: normalized.qualification,
              missingQualificationFields: normalized.missingQualificationFields,
              primaryObjection: normalized.primaryObjection,
              lastInboundAt: new Date().toISOString(),
              lastOutboundAt: new Date().toISOString(),
              followUpCount: 0,
              nextFollowUpAt: nextFollowUpAt(workspace.config),
            });
            console.log(
              `[${workspace.id}] Lead status updated for ${contactName || msg.from}`
            );

            // ── Offer authority: auto-append deal if warranted ──
            if (workspace.config.OFFER_AUTHORITY_ENABLED === "true" && normalized.primaryObjection) {
              const lead = (workspace.leads || []).find(l => l.id === msg.from);
              if (lead) {
                const offer = computeOffer(workspace, lead);
                if (offer) {
                  const offerMsg = buildOfferMessage(offer);
                  if (offerMsg) {
                    replyText = `${replyText}\n\n${offerMsg}`;
                    logOffer(workspace, offer);
                    pushToConversationHistory(workspace.id, msg.from, "assistant", offerMsg, maxTurns);
                    queueAlert(workspace.id, "offer_made", {
                      leadName: contactName || msg.from?.split("@")[0],
                      leadId: msg.from,
                      offerDetails: `${offer.discountPct}% off — strategy: ${offer.strategy}`,
                      reason: `Objection: ${normalized.primaryObjection}`,
                    });
                  }
                }
              }
            }
          } catch (e) {
            console.error(`JSON Parse Error (${provider}):`, e.message);
            replyText = rawContent;
          }
        }
        console.log(`[${workspace.id}] AI Reply generated: ${replyText}`);
      } catch (err) {
        const cause = err.cause ? ` | cause: ${err.cause.code || err.cause.message || err.cause}` : "";
        console.error(`[${workspace.id}] AI Error: ${err.message}${cause}`);
        queueAlert(workspace.id, "ai_error", {
          leadName: contactName || msg.from?.split("@")[0],
          leadId: msg.from,
          error: `${err.message}${cause}`,
          message: msg.body?.slice(0, 150),
        });
      }

      // Detect human request in incoming message → auto-takeover + notify
      const humanKeywords = ["speak to a person", "talk to someone", "human", "real person", "agent", "manager", "supervisor", "speak to human", "real agent"];
      if (humanKeywords.some(kw => incomingText.includes(kw))) {
        // Auto-start human takeover for this contact
        const existing = getHumanTakeover(workspace, msg.from);
        if (!existing) {
          startHumanTakeover(workspace, msg.from, "Auto (lead requested)");
          pushLiveChatMessage(workspace, msg.from, "in", msg.body || "");
        }
        // Override AI reply with human-connecting message
        replyText = "🙋 You've been connected to a human agent. Someone from our team will respond shortly. Please hold on!";
        queueAlert(workspace.id, "human_requested", {
          leadName: contactName || msg.from?.split("@")[0],
          leadId: msg.from,
          message: msg.body?.slice(0, 200),
          reason: "Lead asked for a human — auto-takeover activated",
        });
      }
    }
  }

  // ── Send reply ──
  if (replyText) {
    try {
      await msg.reply(replyText);
      incrementUsage(workspace, "messagesSent");
      updateLeadStatus(workspace, {
        from: msg.from,
        message: msg.body,
        lastOutboundAt: new Date().toISOString(),
        nextFollowUpAt: nextFollowUpAt(workspace.config),
      });
      appendReport(workspace, {
        kind: "auto_reply",
        source: "auto_reply",
        ok: true,
        from: msg.from,
        incoming: incomingText,
        message: replyText,
        mode,
      });
    } catch (err) {
      runtime.lastError = err.message;
      appendReport(workspace, {
        kind: "auto_reply",
        source: "auto_reply",
        ok: false,
        from: msg.from,
        incoming: incomingText,
        message: replyText,
        mode,
        error: err.message,
      });
    }
  }
}

// ─── Stop client ───────────────────────────────────────────────────────────
async function stopWorkspaceClient(workspaceId) {
  const runtime = getRuntime(workspaceId);
  stopScheduler(runtime);
  if (runtime.client) {
    await runtime.client.destroy();
    runtime.client = null;
  }
  runtime.status = "stopped";
  runtime.ready = false;
  runtime.authenticated = false;
  runtime.startRequestedAt = null;
  runtime.authenticatedAt = null;
  runtime.recoveryAttempted = false;
  runtime.recoveryInProgress = false;
  runtime.lastWaState = "";
  runtime.sendInProgress = false;
  runtime.sendStartedAt = null;
  runtime._retryAfterSharedLibFallback = false;
  runtime._forceSystemChrome = false;
  runtime._forceManagedChrome = false;
  runtime._disableSingleProcess = false;
  runtime._failingChromePaths = [];
  runtime.historySyncedContacts = new Set();
  runtime.bookingOfferByLeadId = new Map();
  stopReadyProbe(runtime);
  runtime.qrDataUrl = "";
}

function workspaceSummary(workspace) {
  const runtime = getRuntime(workspace.id);
  return {
    id: workspace.id,
    name: workspace.name,
    status: runtime.status,
    ready: runtime.ready,
    authenticated: runtime.authenticated,
    recipientsCount: workspaceRecipientsChatIds(workspace).length,
    hasScheduler: Boolean(runtime.scheduler),
  };
}

// ─── Scheduled-messages processing ─────────────────────────────────────────
async function processWorkspaceScheduledMessages(workspace) {
  if (
    !Array.isArray(workspace.scheduledMessages) ||
    workspace.scheduledMessages.length === 0
  )
    return false;
  const runtime = getRuntime(workspace.id);
  if (!runtime.client || !runtime.ready) return false;

  const now = new Date();
  let changed = false;

  for (const sched of workspace.scheduledMessages) {
    if (!sched || sched.status !== "pending") continue;
    const sendAt = new Date(sched.sendAt || "");
    if (Number.isNaN(sendAt.getTime())) continue;
    if (sendAt > now) continue;

    try {
      const messageText = sanitizeMultilineText(sched.message || "", "");
      const recipients = workspaceRecipientsChatIds(workspace);
      if (!Array.isArray(recipients) || recipients.length === 0)
        throw new Error("No recipients configured for workspace");

      if (sched.mediaId) {
        const resolved = resolveMediaPath(workspace, sched.mediaId);
        if (!resolved) throw new Error("Media not found");
        for (const chatId of recipients) {
          const media = MessageMedia.fromFilePath(resolved.absPath);
          await runtime.client.sendMessage(chatId, media, {
            caption: messageText || undefined,
          });
          appendReport(workspace, {
            kind: "outgoing",
            source: "scheduled",
            ok: true,
            chatId,
            message: messageText || `(media) ${resolved.filename}`,
          });
        }
      } else {
        for (const chatId of recipients) {
          await runtime.client.sendMessage(chatId, messageText);
          appendReport(workspace, {
            kind: "outgoing",
            source: "scheduled",
            ok: true,
            chatId,
            message: messageText,
          });
        }
      }

      sched.status = "sent";
      sched.sentAt = new Date().toISOString();
      changed = true;
    } catch (err) {
      sched.status = "failed";
      sched.sentAt = new Date().toISOString();
      appendReport(workspace, {
        kind: "outgoing",
        source: "scheduled",
        ok: false,
        message: sched.message || "",
        error: err.message,
      });
      runtime.lastError = `Scheduled send failed: ${err.message}`;
      changed = true;
    }
  }
  return changed;
}

async function processScheduledMessages() {
  try {
    let changed = false;
    for (const ws of store.workspaces) {
      const updated = await processWorkspaceScheduledMessages(ws);
      changed = changed || updated;
    }
    if (changed) saveStore();
  } catch (err) {
    console.error(`[ERROR] processScheduledMessages: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HUMAN TAKEOVER — pause AI for a specific contact, let human agent chat
// ═══════════════════════════════════════════════════════════════════════════

function _takeovers(workspace) {
  if (!workspace._humanTakeover) workspace._humanTakeover = {};
  return workspace._humanTakeover;
}

function getHumanTakeover(workspace, contactId) {
  const map = _takeovers(workspace);
  const entry = map[contactId];
  if (!entry) return null;
  // Auto-expire after configured hours (default 2h)
  const maxMs = (parseInt(workspace.config?.HUMAN_TAKEOVER_TIMEOUT_HRS || "2", 10) || 2) * 60 * 60 * 1000;
  if (Date.now() - new Date(entry.since).getTime() > maxMs) {
    delete map[contactId];
    saveStore();
    console.log(`[${workspace.id}] Human takeover expired for ${contactId}`);
    return null;
  }
  return entry;
}

function startHumanTakeover(workspace, contactId, agentName) {
  const map = _takeovers(workspace);
  map[contactId] = {
    since: new Date().toISOString(),
    agent: agentName || "Agent",
  };
  // Initialise live chat buffer
  if (!workspace._liveChat) workspace._liveChat = {};
  if (!workspace._liveChat[contactId]) workspace._liveChat[contactId] = [];
  saveStore();
  console.log(`[${workspace.id}] Human takeover started for ${contactId} by ${agentName}`);

  // Send notification message to the lead
  const runtime = getRuntime(workspace.id);
  if (runtime.client) {
    const greeting = "👋 Hi! A human agent has joined the conversation. We'll take it from here. How can we help you?";
    runtime.client.sendMessage(contactId, greeting).then(() => {
      pushLiveChatMessage(workspace, contactId, "out", greeting);
      appendReport(workspace, { kind: "outgoing", source: "human_agent", ok: true, chatId: contactId, message: greeting });
    }).catch(err => console.error(`[${workspace.id}] Failed to send takeover greeting: ${err.message}`));
  }

  return map[contactId];
}

function endHumanTakeover(workspace, contactId) {
  const map = _takeovers(workspace);
  const had = !!map[contactId];
  delete map[contactId];
  saveStore();
  if (had) {
    console.log(`[${workspace.id}] Human takeover ended for ${contactId}`);
    // Notify the lead that AI is resuming
    const runtime = getRuntime(workspace.id);
    if (runtime.client) {
      const goodbye = "✅ Thank you for chatting with our team! Our AI assistant is back and ready to help you with anything else. Feel free to ask!";
      runtime.client.sendMessage(contactId, goodbye).then(() => {
        pushLiveChatMessage(workspace, contactId, "out", goodbye);
        appendReport(workspace, { kind: "outgoing", source: "human_agent", ok: true, chatId: contactId, message: goodbye });
      }).catch(err => console.error(`[${workspace.id}] Failed to send takeover goodbye: ${err.message}`));
    }
  }
  return had;
}

function listHumanTakeovers(workspace) {
  const map = _takeovers(workspace);
  const result = [];
  const maxMs = (parseInt(workspace.config?.HUMAN_TAKEOVER_TIMEOUT_HRS || "2", 10) || 2) * 60 * 60 * 1000;
  for (const [contactId, entry] of Object.entries(map)) {
    if (Date.now() - new Date(entry.since).getTime() > maxMs) {
      delete map[contactId];
      continue;
    }
    // Find lead name
    const lead = (workspace.leads || []).find(l => l.id === contactId);
    result.push({
      contactId,
      name: lead?.name || contactId.split("@")[0],
      agent: entry.agent,
      since: entry.since,
    });
  }
  return result;
}

function pushLiveChatMessage(workspace, contactId, direction, text) {
  if (!workspace._liveChat) workspace._liveChat = {};
  if (!workspace._liveChat[contactId]) workspace._liveChat[contactId] = [];
  const buf = workspace._liveChat[contactId];
  buf.push({ dir: direction, text, at: new Date().toISOString() });
  // Keep last 100 messages per contact
  if (buf.length > 100) workspace._liveChat[contactId] = buf.slice(-100);
  saveStore();
}

function getLiveChatMessages(workspace, contactId) {
  if (!workspace._liveChat) return [];
  return workspace._liveChat[contactId] || [];
}

async function sendHumanMessage(workspace, contactId, text) {
  const runtime = getRuntime(workspace.id);
  if (!runtime.client) throw new Error("WhatsApp client is not running.");
  await runtime.client.sendMessage(contactId, text);
  pushLiveChatMessage(workspace, contactId, "out", text);
  appendReport(workspace, {
    kind: "outgoing",
    source: "human_agent",
    ok: true,
    chatId: contactId,
    message: text,
  });
  return true;
}

module.exports = {
  sendBulkMessage,
  createClientForWorkspace,
  stopWorkspaceClient,
  workspaceSummary,
  processWorkspaceScheduledMessages,
  processScheduledMessages,
  setupScheduler,
  setupStatusScheduler,
  getHumanTakeover,
  startHumanTakeover,
  endHumanTakeover,
  listHumanTakeovers,
  getLiveChatMessages,
  sendHumanMessage,
  pushLiveChatMessage,
};
