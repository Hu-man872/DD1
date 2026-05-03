require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const net = require("net");
const tls = require("tls");
const axios = require("axios");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const authMiddleware = require("./middleware/auth");
const Doctor = require("./models/Doctor");
const Patient = require("./models/Patient");
const ReportDelivery = require("./models/ReportDelivery");

const app = express();
const PORT = process.env.PORT || 3000;
const APPOINTMENT_STATUSES = ["confirmed", "showed", "no_show", "rescheduled", "cancelled"];
const FORM_FIELD_ALIASES = {
  notes: ["notes", "doctor_notes", "doctorNotes", "consultation_notes", "consultationNotes", "consultation notes"],
  followup_required: [
    "followup_required",
    "followupRequired",
    "follow_up_required",
    "followUpRequired",
    "need_followup",
    "needFollowup",
    "needs_followup",
    "needsFollowup",
    "folloup_required",
    "folloupRequired",
    "folloup required",
    "folloup",
    "follow up required",
    "follow-up required"
  ],
  followup_days: [
    "followup_days",
    "followupDays",
    "follow_up_days",
    "followUpDays",
    "folloup_days",
    "folloupDays",
    "folloup days"
  ],
  followup_date: [
    "followup_date",
    "followupDate",
    "follow_up_date",
    "followUpDate",
    "folloup_date",
    "folloupDate",
    "folloup date",
    "next_date",
    "nextDate",
    "next_followup_date",
    "nextFollowupDate",
    "next_appointment_date",
    "nextAppointmentDate",
    "next date"
  ],
  reminder_required: [
    "reminder_required",
    "reminderRequired",
    "reminder_needed",
    "reminderNeeded",
    "need_reminder",
    "needReminder",
    "needs_reminder",
    "needsReminder",
    "reminder needed",
    "medication reminder need"
  ],
  reminder_date: ["reminder_date", "reminderDate", "remind_at", "remindAt"]
};
const DOCTOR_FORM_FIELD_ALIASES = {
  "Consultation Notes": ["consultation_notes", "consultationNotes", "consultation notes"],
  "Doctor Notes": ["doctor_notes", "doctorNotes", "doctor notes", "notes"],
  "Reason For Visit": ["reason_for_visit", "reasonForVisit", "reason for visit"],
  "Treatment Status": ["treatment_status", "treatmentStatus", "treatment status"],
  "Follow Up Required": FORM_FIELD_ALIASES.followup_required,
  "Follow Up Days": FORM_FIELD_ALIASES.followup_days,
  "Follow Up Date": FORM_FIELD_ALIASES.followup_date,
  "Medication Required": ["medication_required", "medicationRequired", "medication required"],
  "Medication Reminder Need": FORM_FIELD_ALIASES.reminder_required,
  "Reminder Date": FORM_FIELD_ALIASES.reminder_date,
  "Last Visit Date": ["last_visit_date", "lastVisitDate", "last visit date"],
  "Appointment Time": ["appointment_time", "appointmentTime", "appointment time"],
  "Estimated Wait Time": ["estimated_wait_time", "estimatedWaitTime", "estimated wait time"],
  "Personal Email": ["personal_email", "personalEmail", "personal email"],
  "Appointment Status": ["appointment_status", "appointmentStatus", "appointment status"]
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function assertRequiredEnv() {
  const required = ["MONGO_URI", "JWT_SECRET"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

function normalizePhone(phone) {
  return String(phone || "").trim();
}

function normalizeBoolean(value) {
  const normalized = String(value).trim().toLowerCase();
  return value === true || ["true", "1", "yes", "y", "on", "needed", "required"].includes(normalized);
}

function normalizeAppointmentStatus(status) {
  return String(status || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function formatStatus(status) {
  return String(status || "not_set").replace(/_/g, " ");
}

function formatAppointmentStatus(status) {
  return formatStatus(status || "confirmed");
}

function getFirstValue(...values) {
  const value = values.find((item) => item !== undefined && item !== null && String(item).trim() !== "");
  return value === undefined || value === null ? "" : String(value).trim();
}

function normalizeFieldKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isMeaningfulFormValue(value) {
  if (value === undefined || value === null) {
    return false;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized !== "" && normalized !== "not set" && normalized !== "null" && normalized !== "undefined";
}

function collectNestedFormSources(value, sources = [], depth = 0) {
  if (!value || depth > 5) {
    return sources;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectNestedFormSources(item, sources, depth + 1));
    return sources;
  }

  if (!isPlainObject(value)) {
    return sources;
  }

  sources.push(value);

  Object.entries(value).forEach(([key, item]) => {
    const normalizedKey = normalizeFieldKey(key);
    const shouldReadNested =
      [
        "customdata",
        "customfields",
        "customfield",
        "fields",
        "field",
        "form",
        "submission",
        "answers",
        "answer",
        "data",
        "values",
        "value",
        "properties"
      ].includes(normalizedKey) ||
      Array.isArray(item);

    if (shouldReadNested) {
      collectNestedFormSources(item, sources, depth + 1);
    }
  });

  return sources;
}

function expandFieldObjects(sources) {
  const expandedSources = [...sources];

  sources.forEach((source) => {
    if (!isPlainObject(source)) {
      return;
    }

    const fieldName = getFirstValue(
      source.name,
      source.field_name,
      source.fieldName,
      source.label,
      source.title,
      source.key,
      source.id
    );
    const fieldValue = getFirstValue(
      source.value,
      source.field_value,
      source.fieldValue,
      source.answer,
      source.response
    );

    if (fieldName && isMeaningfulFormValue(fieldValue)) {
      expandedSources.push({ [fieldName]: fieldValue });
    }
  });

  return expandedSources;
}

function getFirstRawField(sources, keys) {
  const normalizedKeys = keys.map(normalizeFieldKey);

  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }

    const normalizedEntries = Object.entries(source).map(([key, value]) => [normalizeFieldKey(key), value]);

    for (const key of keys) {
      const value = source[key];
      if (isMeaningfulFormValue(value)) {
        return value;
      }
    }

    const normalizedMatch = normalizedEntries.find(
      ([key, value]) => normalizedKeys.includes(key) && isMeaningfulFormValue(value)
    );

    if (normalizedMatch) {
      return normalizedMatch[1];
    }
  }

  return undefined;
}

function normalizeOptionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeOptionalDate(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function getDaysUntilDate(date, fromDate = new Date()) {
  if (!date) {
    return 0;
  }

  const target = new Date(date);
  const start = new Date(fromDate);

  target.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);

  const days = Math.ceil((target.getTime() - start.getTime()) / 86400000);
  return Number.isFinite(days) && days > 0 ? days : 0;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeFormDetails(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeFormDetails);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !["password", "token", "authorization", "jwt"].includes(key.toLowerCase()))
        .map(([key, item]) => [key, sanitizeFormDetails(item)])
    );
  }

  return value;
}

function getFormSources(body) {
  const normalizedBody = coerceObject(body);
  return expandFieldObjects(collectNestedFormSources([
    normalizedBody,
    coerceObject(normalizedBody.customData || normalizedBody.custom_data),
    coerceObject(normalizedBody.data),
    coerceObject(normalizedBody.form),
    coerceObject(normalizedBody.fields),
    coerceObject(normalizedBody.submission),
    coerceObject(normalizedBody.answers)
  ]));
}

function getStandardFormFields(body) {
  const sources = getFormSources(body);

  return Object.fromEntries(
    Object.entries(FORM_FIELD_ALIASES)
      .map(([field, aliases]) => [field, getFirstRawField(sources, aliases)])
      .filter(([, value]) => value !== undefined)
  );
}

function getDoctorFormDetails(body) {
  const sources = getFormSources(body);

  return Object.fromEntries(
    Object.entries(DOCTOR_FORM_FIELD_ALIASES)
      .map(([label, aliases]) => [label, getFirstRawField(sources, aliases)])
      .filter(([, value]) => isMeaningfulFormValue(value))
      .map(([label, value]) => [label, sanitizeFormDetails(value)])
  );
}

function applyPatientFormFields(patient, body, options = {}) {
  const fields = getStandardFormFields(body);
  let hasFormFields = false;

  if (options.storeDoctorFormDetails) {
    patient.notes = "";
    patient.followup_required = false;
    patient.followup_days = 0;
    patient.followup_date = null;
    patient.reminder_required = false;
    patient.reminder_date = null;
  }

  if (fields.notes !== undefined) {
    patient.notes = String(fields.notes || "").trim();
    hasFormFields = true;
  }

  if (fields.followup_required !== undefined) {
    patient.followup_required = normalizeBoolean(fields.followup_required);
    hasFormFields = true;
  }

  if (fields.followup_days !== undefined) {
    patient.followup_days = normalizeOptionalNumber(fields.followup_days);
    hasFormFields = true;
  }

  if (fields.followup_date !== undefined) {
    const followupDate = normalizeOptionalDate(fields.followup_date);
    patient.followup_date = followupDate || null;
    patient.followup_days = getDaysUntilDate(patient.followup_date);
    hasFormFields = true;
  }

  if (fields.reminder_required !== undefined) {
    patient.reminder_required = normalizeBoolean(fields.reminder_required);
    hasFormFields = true;
  }

  if (fields.reminder_date !== undefined) {
    const reminderDate = normalizeOptionalDate(fields.reminder_date);
    patient.reminder_date = reminderDate || null;
    hasFormFields = true;
  }

  if (hasFormFields || options.storeDoctorFormDetails) {
    patient.consultation_details = getDoctorFormDetails(body);
    patient.last_form_submission_at = new Date();
  }

  return hasFormFields;
}

function parseRequestBody(body) {
  if (typeof body !== "string") {
    return body || {};
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    return Object.fromEntries(new URLSearchParams(body));
  }
}

function coerceObject(value) {
  const parsedValue = parseRequestBody(value);
  return parsedValue && typeof parsedValue === "object" ? parsedValue : {};
}

function extractGhlPatientPayload(rawBody) {
  const body = coerceObject(rawBody);
  const customData = coerceObject(body.customData || body.custom_data || body.data);
  const contact = coerceObject(body.contact);

  const firstName = getFirstValue(
    body.first_name,
    body.firstName,
    body.contact_first_name,
    customData.first_name,
    customData.firstName,
    customData.contact_first_name,
    contact.first_name,
    contact.firstName
  );

  const lastName = getFirstValue(
    body.last_name,
    body.lastName,
    body.contact_last_name,
    customData.last_name,
    customData.lastName,
    customData.contact_last_name,
    contact.last_name,
    contact.lastName
  );

  const name = getFirstValue(
    body.name,
    body.full_name,
    body.fullName,
    body.contact_name,
    customData.name,
    customData.full_name,
    customData.fullName,
    customData.contact_name,
    contact.name,
    contact.full_name,
    contact.fullName,
    `${firstName} ${lastName}`.trim()
  );

  const phone = normalizePhone(
    getFirstValue(
      body.phone,
      body.phone_number,
      body.phoneNumber,
      body.contact_phone,
      customData.phone,
      customData.phone_number,
      customData.phoneNumber,
      customData.contact_phone,
      contact.phone,
      contact.phone_number,
      contact.phoneNumber
    )
  );

  return {
    body,
    name,
    phone
  };
}

async function getNextQueuePosition() {
  const lastPatient = await Patient.findOne({ status: { $ne: "completed" } })
    .sort({ position: -1 })
    .select("position")
    .lean();

  return (lastPatient?.position || 0) + 1;
}

async function sendUpdateToGhl(payload) {
  if (!process.env.GHL_WEBHOOK_URL) {
    console.warn("GHL_WEBHOOK_URL is not configured. Skipping outbound GHL webhook.");
    return { sent: false, reason: "missing_webhook_url" };
  }

  try {
    await axios.post(process.env.GHL_WEBHOOK_URL, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000
    });

    return { sent: true };
  } catch (error) {
    console.error("Failed to send update to GHL:", error.message);
    return { sent: false, reason: error.message };
  }
}

async function updatePatientAppointmentStatus(phone, appointmentStatus) {
  const normalizedStatus = normalizeAppointmentStatus(appointmentStatus);

  if (!phone) {
    return {
      error: { statusCode: 400, message: "Phone is required." }
    };
  }

  if (!APPOINTMENT_STATUSES.includes(normalizedStatus)) {
    return {
      error: {
        statusCode: 400,
        message: "Invalid appointment status.",
        allowed_statuses: APPOINTMENT_STATUSES
      }
    };
  }

  const patient = await Patient.findOne({ phone });
  if (!patient) {
    return {
      error: { statusCode: 404, message: "Patient not found." }
    };
  }

  // Appointment status is separate from queue status. Changing this dropdown
  // does not complete the patient or shift queue positions.
  patient.appointment_status = normalizedStatus;
  await patient.save();

  const ghlPayload = {
    phone: patient.phone,
    appointment_status: patient.appointment_status
  };
  const ghl = await sendUpdateToGhl(ghlPayload);

  return { patient, ghl };
}

function parseDateOnly(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function formatDateForInput(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function formatReportDate(date) {
  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
}

function getReportRange(query = {}) {
  const start = parseDateOnly(query.start);
  const end = parseDateOnly(query.end);

  if (!start || !end) {
    const today = new Date();
    const defaultEnd = addDays(parseDateOnly(formatDateForInput(today)), 1);
    const defaultStart = addDays(defaultEnd, -7);
    return { start: defaultStart, end: defaultEnd };
  }

  return { start, end: addDays(end, 1) };
}

function getPreviousMonthRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    start,
    end,
    key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`
  };
}

function countBy(items, field, allowedValues = []) {
  const counts = Object.fromEntries(allowedValues.map((value) => [value, 0]));

  items.forEach((item) => {
    const value = item[field] || "not_set";
    counts[value] = (counts[value] || 0) + 1;
  });

  return counts;
}

function toPercent(count, total) {
  if (!total) {
    return 0;
  }

  return Math.round((count / total) * 100);
}

function getDailyCounts(patients, start, end) {
  const counts = {};
  let cursor = new Date(start);

  while (cursor < end) {
    counts[formatDateForInput(cursor)] = 0;
    cursor = addDays(cursor, 1);
  }

  patients.forEach((patient) => {
    const date = patient.join_time || patient.createdAt;
    if (!date) {
      return;
    }

    const key = formatDateForInput(new Date(date));
    if (counts[key] !== undefined) {
      counts[key] += 1;
    }
  });

  return Object.entries(counts).map(([date, count]) => ({ date, count }));
}

function createClinicInsights(summary) {
  const insights = [];

  if (summary.totals.newPatients === 0) {
    insights.push("No new patients were added in this period.");
  } else {
    insights.push(`${summary.rates.showRate}% of period patients are marked as showed.`);
  }

  if (summary.rates.noShowRate > 15) {
    insights.push(`No-show rate is ${summary.rates.noShowRate}%, which needs front-desk attention.`);
  }

  if (summary.totals.followupRequired > 0) {
    insights.push(`${summary.totals.followupRequired} patients need follow-up from this period.`);
  }

  if (summary.totals.formsSubmitted < summary.totals.showed) {
    insights.push("Some showed patients do not yet have consultation form data saved.");
  }

  if (summary.totals.completedTreatments < summary.totals.showed) {
    insights.push("Some showed patients are not marked treatment done yet.");
  }

  if (insights.length === 0) {
    insights.push("Clinic flow looks stable for this period.");
  }

  return insights;
}

async function buildClinicReport(start, end) {
  const periodQuery = { join_time: { $gte: start, $lt: end } };
  const activityQuery = {
    $or: [
      { join_time: { $gte: start, $lt: end } },
      { updatedAt: { $gte: start, $lt: end } },
      { last_form_submission_at: { $gte: start, $lt: end } }
    ]
  };

  const [periodPatients, activeQueueCount, completedTreatments, formsSubmitted, activeFollowups, activityPatients] =
    await Promise.all([
      Patient.find(periodQuery).sort({ join_time: 1 }).lean(),
      Patient.countDocuments({ status: { $ne: "completed" } }),
      Patient.countDocuments({ status: "completed", updatedAt: { $gte: start, $lt: end } }),
      Patient.countDocuments({ last_form_submission_at: { $gte: start, $lt: end } }),
      Patient.countDocuments({ followup_required: true, status: { $ne: "completed" } }),
      Patient.find(activityQuery)
        .sort({ followup_required: -1, reminder_required: -1, updatedAt: -1 })
        .limit(30)
        .lean()
    ]);

  const appointmentStatuses = countBy(periodPatients, "appointment_status", APPOINTMENT_STATUSES);
  const queueStatuses = countBy(periodPatients, "status", ["waiting", "in_progress", "completed"]);
  const showed = appointmentStatuses.showed || 0;
  const noShows = appointmentStatuses.no_show || 0;
  const rescheduled = appointmentStatuses.rescheduled || 0;
  const cancelled = appointmentStatuses.cancelled || 0;
  const followupRequired = periodPatients.filter((patient) => patient.followup_required).length;
  const remindersScheduled = periodPatients.filter((patient) => patient.reminder_required).length;
  const patientsNeedingAttention = activityPatients
    .filter((patient) =>
      patient.followup_required ||
      patient.reminder_required ||
      ["no_show", "rescheduled", "cancelled"].includes(patient.appointment_status)
    )
    .slice(0, 12)
    .map((patient) => ({
      name: patient.name,
      phone: patient.phone,
      appointment_status: patient.appointment_status,
      status: patient.status,
      followup_required: patient.followup_required,
      followup_date: patient.followup_date,
      reminder_required: patient.reminder_required,
      reminder_date: patient.reminder_date,
      notes: patient.notes
    }));

  const summary = {
    generatedAt: new Date(),
    period: {
      start,
      end,
      label: `${formatReportDate(start)} - ${formatReportDate(addDays(end, -1))}`
    },
    totals: {
      newPatients: periodPatients.length,
      showed,
      noShows,
      rescheduled,
      cancelled,
      completedTreatments,
      activeQueue: activeQueueCount,
      followupRequired,
      activeFollowups,
      remindersScheduled,
      formsSubmitted
    },
    rates: {
      showRate: toPercent(showed, periodPatients.length),
      noShowRate: toPercent(noShows, periodPatients.length),
      completionRate: toPercent(completedTreatments, Math.max(showed, periodPatients.length))
    },
    appointmentStatuses,
    queueStatuses,
    dailyCounts: getDailyCounts(periodPatients, start, end),
    patientsNeedingAttention
  };

  summary.insights = createClinicInsights(summary);
  return summary;
}

function reportToLines(report) {
  const lines = [
    "Doctor Dashboard Clinic Report",
    `Period: ${report.period.label}`,
    `Generated: ${formatReportDate(report.generatedAt)}`,
    "",
    "Key Metrics",
    `New patients: ${report.totals.newPatients}`,
    `Showed: ${report.totals.showed} (${report.rates.showRate}%)`,
    `No show: ${report.totals.noShows} (${report.rates.noShowRate}%)`,
    `Rescheduled: ${report.totals.rescheduled}`,
    `Cancelled: ${report.totals.cancelled}`,
    `Completed treatments: ${report.totals.completedTreatments}`,
    `Active queue right now: ${report.totals.activeQueue}`,
    `Follow-up required: ${report.totals.followupRequired}`,
    `Active follow-up backlog: ${report.totals.activeFollowups}`,
    `Reminders scheduled: ${report.totals.remindersScheduled}`,
    `Forms submitted: ${report.totals.formsSubmitted}`,
    "",
    "Clinic Insights",
    ...report.insights.map((insight) => `- ${insight}`),
    "",
    "Appointment Status Breakdown",
    ...Object.entries(report.appointmentStatuses).map(([status, count]) => `- ${formatStatus(status)}: ${count}`),
    "",
    "Daily Patient Flow",
    ...report.dailyCounts.map((item) => `- ${item.date}: ${item.count}`)
  ];

  if (report.patientsNeedingAttention.length > 0) {
    lines.push("", "Patients Needing Attention");
    report.patientsNeedingAttention.forEach((patient) => {
      lines.push(
        `- ${patient.name || "Patient"} | ${patient.phone || ""} | ${formatAppointmentStatus(patient.appointment_status)} | Follow-up: ${patient.followup_required ? "Yes" : "No"}`
      );
    });
  }

  return lines;
}

function escapePdfText(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapText(text, maxLength = 92) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let currentLine = "";

  words.forEach((word) => {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length > maxLength && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = nextLine;
    }
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [""];
}

function createPdfBuffer(lines) {
  const pageHeight = 842;
  const pageWidth = 595;
  const marginX = 48;
  const topY = 790;
  const lineHeight = 16;
  const linesPerPage = 45;
  const wrappedLines = lines.flatMap((line) => wrapText(line));
  const pages = [];

  for (let index = 0; index < wrappedLines.length; index += linesPerPage) {
    pages.push(wrappedLines.slice(index, index + linesPerPage));
  }

  const objects = [];
  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };

  const catalogRef = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesRef = addObject("");
  const fontRef = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageRefs = [];

  pages.forEach((pageLines) => {
    const content = [
      "BT",
      `/F1 11 Tf`,
      `${marginX} ${topY} Td`,
      `${lineHeight} TL`,
      ...pageLines.map((line) => `(${escapePdfText(line)}) Tj T*`),
      "ET"
    ].join("\n");
    const contentRef = addObject(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    const pageRef = addObject(
      `<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontRef} 0 R >> >> /Contents ${contentRef} 0 R >>`
    );
    pageRefs.push(pageRef);
  });

  objects[pagesRef - 1] = `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogRef} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}

function createReportPdf(report) {
  return createPdfBuffer(reportToLines(report));
}

function isSmtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function createEmailMessage({ from, to, subject, text, attachmentName, attachmentBuffer }) {
  const boundary = `doctor-dashboard-${crypto.randomBytes(8).toString("hex")}`;
  const attachment = attachmentBuffer.toString("base64").replace(/.{1,76}/g, "$&\r\n");

  return [
    `From: ${from}`,
    `To: ${to.join(", ")}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    text,
    "",
    `--${boundary}`,
    `Content-Type: application/pdf; name="${attachmentName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${attachmentName}"`,
    "",
    attachment,
    `--${boundary}--`,
    ""
  ].join("\r\n");
}

function waitForSmtpResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", reject);
    };
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const lastLine = lines[lines.length - 1] || "";

      if (/^\d{3} /.test(lastLine)) {
        cleanup();
        resolve(buffer);
      }
    };

    socket.on("data", onData);
    socket.on("error", reject);
  });
}

async function sendSmtpCommand(socket, command, expectedCodes = []) {
  socket.write(`${command}\r\n`);
  const response = await waitForSmtpResponse(socket);
  const code = Number(response.slice(0, 3));

  if (expectedCodes.length > 0 && !expectedCodes.includes(code)) {
    throw new Error(`SMTP command failed: ${command} -> ${response.trim()}`);
  }

  return response;
}

async function sendEmailWithAttachment({ to, subject, text, attachmentName, attachmentBuffer }) {
  if (!isSmtpConfigured()) {
    throw new Error("SMTP is not configured.");
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;
  const from = process.env.SMTP_FROM;
  let socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });

  await waitForSmtpResponse(socket);
  await sendSmtpCommand(socket, `EHLO ${host}`, [250]);

  if (!secure && port !== 25) {
    await sendSmtpCommand(socket, "STARTTLS", [220]);
    socket = tls.connect({ socket, servername: host });
    await sendSmtpCommand(socket, `EHLO ${host}`, [250]);
  }

  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    await sendSmtpCommand(socket, "AUTH LOGIN", [334]);
    await sendSmtpCommand(socket, Buffer.from(process.env.SMTP_USER).toString("base64"), [334]);
    await sendSmtpCommand(socket, Buffer.from(process.env.SMTP_PASS).toString("base64"), [235]);
  }

  const message = createEmailMessage({
    from,
    to,
    subject,
    text,
    attachmentName,
    attachmentBuffer
  });

  await sendSmtpCommand(socket, `MAIL FROM:<${from}>`, [250]);
  for (const recipient of to) {
    await sendSmtpCommand(socket, `RCPT TO:<${recipient}>`, [250, 251]);
  }
  await sendSmtpCommand(socket, "DATA", [354]);
  socket.write(`${message}\r\n.\r\n`);
  await waitForSmtpResponse(socket);
  await sendSmtpCommand(socket, "QUIT", [221]);
  socket.end();
}

async function getMonthlyReportRecipients() {
  const configuredRecipients = String(process.env.MONTHLY_REPORT_TO_EMAIL || "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);

  if (configuredRecipients.length > 0) {
    return configuredRecipients;
  }

  const doctors = await Doctor.find({}).select("email").lean();
  return doctors.map((doctor) => doctor.email).filter(Boolean);
}

async function sendMonthlyReportIfDue({ force = false } = {}) {
  const now = new Date();

  if (!force && now.getDate() !== 1) {
    return;
  }

  if (!isSmtpConfigured()) {
    console.warn("Monthly report email skipped because SMTP is not configured.");
    return;
  }

  const range = getPreviousMonthRange(now);
  const reportKey = `monthly-${range.key}`;
  const existingDelivery = await ReportDelivery.findOne({ report_key: reportKey }).lean();

  if (existingDelivery && existingDelivery.status === "sent") {
    return;
  }

  const recipients = await getMonthlyReportRecipients();
  if (recipients.length === 0) {
    console.warn("Monthly report email skipped because no doctor email recipients were found.");
    return;
  }

  const report = await buildClinicReport(range.start, range.end);
  const pdf = createReportPdf(report);

  try {
    await sendEmailWithAttachment({
      to: recipients,
      subject: `Clinic monthly report - ${report.period.label}`,
      text: `Attached is the clinic report for ${report.period.label}.`,
      attachmentName: `clinic-report-${range.key}.pdf`,
      attachmentBuffer: pdf
    });

    await ReportDelivery.findOneAndUpdate(
      { report_key: reportKey },
      {
        report_key: reportKey,
        period_start: range.start,
        period_end: range.end,
        recipients,
        status: "sent",
        error: "",
        sent_at: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    await ReportDelivery.findOneAndUpdate(
      { report_key: reportKey },
      {
        report_key: reportKey,
        period_start: range.start,
        period_end: range.end,
        recipients,
        status: "failed",
        error: error.message,
        sent_at: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.error("Monthly report email failed:", error.message);
  }
}

app.post("/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const doctor = await Doctor.findOne({ email }).select("+password");
    if (!doctor) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const passwordMatches = await doctor.comparePassword(password);
    if (!passwordMatches) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const token = jwt.sign(
      { doctorId: doctor._id.toString(), email: doctor.email },
      process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );

    return res.json({
      token,
      doctor: {
        id: doctor._id,
        email: doctor.email
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Unable to log in." });
  }
});

/*
  GHL -> Backend

  In GoHighLevel, create a workflow:
  - Trigger: Appointment booked
  - Action: Webhook
  - Method: POST
  - URL: https://your-domain.com/add
  - JSON payload:
    {
      "name": "{{contact.first_name}} {{contact.last_name}}",
      "phone": "{{contact.phone}}"
    }

  This route is intentionally public because GHL calls it directly when a patient
  books an appointment. If you expose this in production, add a shared secret
  header or signature verification so only GHL can create queue entries.
*/
app.post("/add", async (req, res) => {
  try {
    const { body, name, phone } = extractGhlPatientPayload(req.body);

    if (!name || !phone) {
      console.warn("GHL /add request missing name or phone:", JSON.stringify(body, null, 2));
      return res.status(400).json({
        message: "Name and phone are required.",
        received_body: body,
        expected_examples: [
          { name: "Test Patient", phone: "+918123456789" },
          { customData: { name: "Test Patient", phone: "+918123456789" } },
          { contact: { first_name: "Test", last_name: "Patient", phone: "+918123456789" } }
        ]
      });
    }

    const existingPatient = await Patient.findOne({ phone });
    if (existingPatient && existingPatient.status !== "completed") {
      return res.status(200).json({
        message: "Patient is already in the active queue.",
        patient: existingPatient
      });
    }

    const nextPosition = await getNextQueuePosition();
    const patient = existingPatient || new Patient({ phone });

    patient.name = name;
    patient.status = "waiting";
    patient.appointment_status = "confirmed";
    patient.position = nextPosition;
    patient.join_time = new Date();
    patient.notes = "";
    patient.followup_required = false;
    patient.followup_days = 0;
    patient.followup_date = null;
    patient.reminder_required = false;
    patient.reminder_date = null;
    patient.consultation_details = {};
    patient.last_form_submission_at = null;

    await patient.save();

    return res.status(existingPatient ? 200 : 201).json({
      message: "Patient added to queue.",
      patient
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Phone number already exists." });
    }

    console.error("Add patient error:", error);
    return res.status(500).json({ message: "Unable to add patient." });
  }
});

/*
  GHL consultation form -> Backend

  Use this route from a GHL workflow that runs after the consultation form is
  submitted. It stores follow-up, reminder, next-date, notes, and the full form
  payload on the matching patient so the dashboard can show it when a name is
  clicked.
*/
app.post("/consultation", async (req, res) => {
  try {
    const { body, name, phone } = extractGhlPatientPayload(req.body);

    if (!phone) {
      return res.status(400).json({
        message: "Phone is required.",
        received_body: body
      });
    }

    const patient = await Patient.findOne({ phone });
    if (!patient) {
      return res.status(404).json({ message: "Patient not found." });
    }

    if (name) {
      patient.name = name;
    }

    applyPatientFormFields(patient, body, { storeDoctorFormDetails: true });
    const savedFormFields = Object.keys(patient.consultation_details || {});
    if (savedFormFields.length === 0) {
      console.warn("Consultation webhook received but no doctor form fields matched:", JSON.stringify(body, null, 2));
    }
    await patient.save();

    return res.json({
      message: "Consultation form details saved.",
      saved_form_fields: savedFormFields,
      patient
    });
  } catch (error) {
    console.error("Consultation form save error:", error);
    return res.status(500).json({ message: "Unable to save consultation form details." });
  }
});

app.get("/patients", authMiddleware, async (req, res) => {
  try {
    const view = String(req.query.view || "active").trim().toLowerCase();
    const query = view === "completed" ? { status: "completed" } : { status: { $ne: "completed" } };
    const sort = view === "completed" ? { updatedAt: -1, join_time: -1 } : { position: 1, join_time: 1 };
    const patients = await Patient.find(query).sort(sort).lean();

    return res.json({ patients });
  } catch (error) {
    console.error("Fetch patients error:", error);
    return res.status(500).json({ message: "Unable to fetch patients." });
  }
});

/*
  Dashboard appointment status updates

  The frontend dropdown calls this protected route whenever the doctor chooses
  Confirmed, Showed, No Show, Rescheduled, or Cancelled. The route stores the
  selected appointment_status in MongoDB and sends exactly that status to GHL.
*/
app.post("/update-status", authMiddleware, async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const appointmentStatus = req.body.appointment_status;
    const result = await updatePatientAppointmentStatus(phone, appointmentStatus);

    if (result.error) {
      return res.status(result.error.statusCode).json(result.error);
    }

    return res.json({
      message: "Appointment status updated.",
      patient: result.patient,
      ghl: result.ghl
    });
  } catch (error) {
    console.error("Update appointment status error:", error);
    return res.status(500).json({ message: "Unable to update appointment status." });
  }
});

/*
  Backend -> GHL

  When the doctor updates a patient from the dashboard, this route sends the
  patient update to GHL using GHL_WEBHOOK_URL.

  In GoHighLevel, create a second workflow:
  - Trigger: Incoming Webhook
  - Copy the generated webhook URL into GHL_WEBHOOK_URL in .env
  - Then add actions such as:
    - Update contact fields
    - Send WhatsApp or SMS
    - Trigger follow-up automation

  Outbound payload sent by this backend:
    {
      phone,
      appointment_status,
      status,
      followup_required,
      followup_days,
      notes
    }
*/
app.post("/update", authMiddleware, async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const status = String(req.body.status || "").trim();
    const hasAppointmentStatus = req.body.appointment_status !== undefined;
    const appointmentStatus = normalizeAppointmentStatus(req.body.appointment_status);
    const allowedStatuses = ["waiting", "in_progress", "completed"];

    if (!phone) {
      return res.status(400).json({ message: "Phone is required." });
    }

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid patient status." });
    }

    if (hasAppointmentStatus && !APPOINTMENT_STATUSES.includes(appointmentStatus)) {
      return res.status(400).json({
        message: "Invalid appointment status.",
        allowed_statuses: APPOINTMENT_STATUSES
      });
    }

    const patient = await Patient.findOne({ phone });
    if (!patient) {
      return res.status(404).json({ message: "Patient not found." });
    }

    const previousStatus = patient.status;
    const previousPosition = patient.position;

    if (status) {
      patient.status = status;
    }

    if (hasAppointmentStatus) {
      patient.appointment_status = appointmentStatus;
    }

    if (req.body.followup_required !== undefined) {
      patient.followup_required = normalizeBoolean(req.body.followup_required);
    }

    if (req.body.followup_days !== undefined) {
      const followupDays = Number(req.body.followup_days);
      patient.followup_days = Number.isFinite(followupDays) && followupDays > 0 ? followupDays : 0;
    }

    if (req.body.notes !== undefined) {
      patient.notes = String(req.body.notes || "").trim();
    }

    if (req.body.followup_date !== undefined || req.body.next_date !== undefined) {
      const followupDate = normalizeOptionalDate(req.body.followup_date || req.body.next_date);
      patient.followup_date = followupDate || null;
      patient.followup_days = getDaysUntilDate(patient.followup_date);
    }

    if (req.body.reminder_required !== undefined || req.body.reminder_needed !== undefined) {
      patient.reminder_required = normalizeBoolean(req.body.reminder_required ?? req.body.reminder_needed);
    }

    if (req.body.reminder_date !== undefined) {
      const reminderDate = normalizeOptionalDate(req.body.reminder_date);
      patient.reminder_date = reminderDate || null;
    }

    applyPatientFormFields(patient, req.body);

    if (previousStatus === "completed" && patient.status !== "completed") {
      patient.position = await getNextQueuePosition();
      await patient.save();
    } else if (patient.status === "completed" && previousStatus !== "completed") {
      patient.position = 0;
      await patient.save();

      await Patient.updateMany(
        {
          status: { $ne: "completed" },
          position: { $gt: previousPosition }
        },
        { $inc: { position: -1 } }
      );
    } else {
      await patient.save();
    }

    const queueFieldsPresent =
      Boolean(status) ||
      req.body.followup_required !== undefined ||
      req.body.followup_days !== undefined ||
      req.body.followup_date !== undefined ||
      req.body.next_date !== undefined ||
      req.body.reminder_required !== undefined ||
      req.body.reminder_needed !== undefined ||
      req.body.reminder_date !== undefined ||
      req.body.notes !== undefined;
    const ghlPayload =
      hasAppointmentStatus && !queueFieldsPresent
        ? {
            phone: patient.phone,
            appointment_status: patient.appointment_status
          }
        : {
            phone: patient.phone,
            appointment_status: patient.appointment_status,
            status: patient.status,
            followup_required: patient.followup_required,
            followup_days: patient.followup_days,
            followup_date: patient.followup_date,
            reminder_required: patient.reminder_required,
            reminder_date: patient.reminder_date,
            notes: patient.notes
          };

    const ghl = await sendUpdateToGhl(ghlPayload);

    return res.json({
      message: "Patient updated.",
      patient,
      ghl
    });
  } catch (error) {
    console.error("Update patient error:", error);
    return res.status(500).json({ message: "Unable to update patient." });
  }
});

app.get("/reports/summary", authMiddleware, async (req, res) => {
  try {
    const { start, end } = getReportRange(req.query);

    if (start >= end) {
      return res.status(400).json({ message: "Report start date must be before end date." });
    }

    const report = await buildClinicReport(start, end);
    return res.json({ report });
  } catch (error) {
    console.error("Report summary error:", error);
    return res.status(500).json({ message: "Unable to generate report." });
  }
});

app.get("/reports/pdf", authMiddleware, async (req, res) => {
  try {
    const { start, end } = getReportRange(req.query);

    if (start >= end) {
      return res.status(400).json({ message: "Report start date must be before end date." });
    }

    const report = await buildClinicReport(start, end);
    const pdf = createReportPdf(report);
    const filename = `clinic-report-${formatDateForInput(start)}-to-${formatDateForInput(addDays(end, -1))}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(pdf);
  } catch (error) {
    console.error("Report PDF error:", error);
    return res.status(500).json({ message: "Unable to generate report PDF." });
  }
});

app.post("/reports/send-monthly", authMiddleware, async (req, res) => {
  try {
    await sendMonthlyReportIfDue({ force: true });
    return res.json({ message: "Monthly report send attempted. Check server logs or report delivery records for SMTP result." });
  } catch (error) {
    console.error("Manual monthly report email error:", error);
    return res.status(500).json({ message: "Unable to send monthly report." });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function startServer() {
  assertRequiredEnv();

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  app.listen(PORT, () => {
    console.log(`Doctor dashboard running at http://localhost:${PORT}`);
  });

  sendMonthlyReportIfDue().catch((error) => {
    console.error("Monthly report scheduler startup check failed:", error.message);
  });
  setInterval(() => {
    sendMonthlyReportIfDue().catch((error) => {
      console.error("Monthly report scheduler failed:", error.message);
    });
  }, 60 * 60 * 1000);
}

startServer().catch((error) => {
  console.error("Server startup failed:", error.message);
  process.exit(1);
});
