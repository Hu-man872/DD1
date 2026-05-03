const token = localStorage.getItem("doctor_dashboard_token");
const patientList = document.getElementById("patientList");
const patientTemplate = document.getElementById("patientTemplate");
const dashboardMessage = document.getElementById("dashboardMessage");
const queueCount = document.getElementById("queueCount");
const viewTitle = document.getElementById("viewTitle");
const todayLabel = document.getElementById("todayLabel");
const patientSearch = document.getElementById("patientSearch");
const dateFilter = document.getElementById("dateFilter");
const nameFilter = document.getElementById("nameFilter");
const phoneFilter = document.getElementById("phoneFilter");
const clearFiltersButton = document.getElementById("clearFiltersButton");
const activeMetric = document.getElementById("activeMetric");
const showedMetric = document.getElementById("showedMetric");
const pendingMetric = document.getElementById("pendingMetric");
const refreshButton = document.getElementById("refreshButton");
const logoutButton = document.getElementById("logoutButton");
const activeViewButton = document.getElementById("activeViewButton");
const treatedViewButton = document.getElementById("treatedViewButton");
const patientsSectionButton = document.getElementById("patientsSectionButton");
const reportsSectionButton = document.getElementById("reportsSectionButton");
const patientsView = document.getElementById("patientsView");
const reportsView = document.getElementById("reportsView");
const detailOverlay = document.getElementById("detailOverlay");
const patientDetail = document.getElementById("patientDetail");
const closeDetailButton = document.getElementById("closeDetailButton");
const detailTitle = document.getElementById("detailTitle");
const detailSubtitle = document.getElementById("detailSubtitle");
const visitDetails = document.getElementById("visitDetails");
const followupDetails = document.getElementById("followupDetails");
const formDetails = document.getElementById("formDetails");
const reportPeriod = document.getElementById("reportPeriod");
const reportStartDate = document.getElementById("reportStartDate");
const reportEndDate = document.getElementById("reportEndDate");
const generateReportButton = document.getElementById("generateReportButton");
const downloadReportButton = document.getElementById("downloadReportButton");
const reportPreview = document.getElementById("reportPreview");
const reportNewPatients = document.getElementById("reportNewPatients");
const reportShowRate = document.getElementById("reportShowRate");
const reportNoShow = document.getElementById("reportNoShow");
const reportFollowups = document.getElementById("reportFollowups");
const reportForms = document.getElementById("reportForms");
const reportInsights = document.getElementById("reportInsights");
const reportMessage = document.getElementById("reportMessage");
const CONSULTATION_FORM_URL = "https://brand.ariesmediacompany.com/widget/form/TNnFV59elnOAmxzym3jv";
const FORM_DETAIL_LABELS = new Set([
  "Consultation Notes",
  "Doctor Notes",
  "Reason For Visit",
  "Treatment Status",
  "Follow Up Required",
  "Follow Up Days",
  "Follow Up Date",
  "Medication Required",
  "Medication Reminder Need",
  "Reminder Date",
  "Last Visit Date",
  "Appointment Time",
  "Estimated Wait Time",
  "Personal Email",
  "Appointment Status"
]);
const SUMMARY_FORM_LABELS = new Set([
  "Doctor Notes",
  "Consultation Notes",
  "Follow Up Required",
  "Follow Up Days",
  "Follow Up Date",
  "Medication Reminder Need",
  "Reminder Date"
]);
let currentView = "active";
let currentSection = "patients";
let patientCache = [];
let selectedPatientPhone = "";
let isFetchingPatients = false;

if (!token) {
  window.location.href = "/";
}

function setMessage(message) {
  dashboardMessage.textContent = message || "";
}

function setDashboardSection(section) {
  currentSection = section;
  const isReports = currentSection === "reports";

  patientsView.hidden = isReports;
  reportsView.hidden = !isReports;
  patientsSectionButton.classList.toggle("is-active", !isReports);
  reportsSectionButton.classList.toggle("is-active", isReports);
  viewTitle.textContent = isReports
    ? "Clinic Reports"
    : currentView === "completed"
      ? "Already Treated Patients"
      : "Active Patients";
  queueCount.textContent = isReports
    ? "Generate report by period"
    : currentView === "completed"
      ? `${patientCache.length} treated`
      : `${patientCache.length} active`;

  if (isReports) {
    closePatientDetails();
  }
}

function setReportMessage(message) {
  reportMessage.textContent = message || "";
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  };
}

function formatStatus(status) {
  return String(status || "").replace(/_/g, " ");
}

function formatAppointmentStatus(status) {
  return formatStatus(status || "confirmed");
}

function getInitials(name) {
  return String(name || "Patient")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function getSearchText(patient) {
  return `${patient.name || ""} ${patient.phone || ""} ${patient.appointment_status || ""}`.toLowerCase();
}

function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function getPatientDate(patient) {
  const value = currentView === "completed" ? patient.updatedAt || patient.join_time : patient.join_time || patient.createdAt;
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function formatDateOnly(value) {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "Not set";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "Not set";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatYesNo(value) {
  return value ? "Yes" : "No";
}

function formatDetailValue(value) {
  if (value === undefined || value === null || value === "") {
    return "Not set";
  }

  if (typeof value === "boolean") {
    return formatYesNo(value);
  }

  if (Array.isArray(value)) {
    return value.map(formatDetailValue).join(", ");
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function hasMeaningfulDetailValue(value) {
  if (value === undefined || value === null) {
    return false;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized !== "" && normalized !== "not set" && normalized !== "null" && normalized !== "undefined";
}

function titleizeKey(key) {
  return String(key || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function flattenDetails(value, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [[prefix, value]] : [];
  }

  return Object.entries(value).flatMap(([key, item]) => {
    const detailKey = prefix ? `${prefix}.${key}` : key;

    if (item && typeof item === "object" && !Array.isArray(item)) {
      return flattenDetails(item, detailKey);
    }

    return [[detailKey, item]];
  });
}

function getVisibleFormRows(details, options = {}) {
  const excludedLabels = options.excludeLabels || new Set();

  return flattenDetails(details || {})
    .map(([key, value]) => [titleizeKey(key), value])
    .filter(
      ([label, value]) =>
        FORM_DETAIL_LABELS.has(label) &&
        !excludedLabels.has(label) &&
        hasMeaningfulDetailValue(value)
    );
}

function getFormDetailValue(details, label) {
  const rows = flattenDetails(details || {}).map(([key, value]) => [titleizeKey(key), value]);
  const match = rows.find(([rowLabel]) => rowLabel === label);
  return match ? match[1] : undefined;
}

function isYesValue(value) {
  return ["yes", "true", "1", "required", "needed", "on"].includes(String(value || "").trim().toLowerCase());
}

function isNoValue(value) {
  return ["no", "false", "0", "not set", "none", "off"].includes(String(value || "").trim().toLowerCase());
}

function getEffectiveFollowupRequired(patient) {
  const formValue = getFormDetailValue(patient.consultation_details, "Follow Up Required");

  if (isYesValue(formValue)) {
    return true;
  }

  if (isNoValue(formValue) || patient.last_form_submission_at) {
    return false;
  }

  return Boolean(patient.followup_required);
}

function getEffectiveReminderRequired(patient) {
  const formValue = getFormDetailValue(patient.consultation_details, "Medication Reminder Need");

  if (isYesValue(formValue)) {
    return true;
  }

  if (isNoValue(formValue) || patient.last_form_submission_at) {
    return false;
  }

  return Boolean(patient.reminder_required);
}

function getFollowupDaysFromDate(value) {
  const target = value ? new Date(value) : null;

  if (!target || Number.isNaN(target.getTime())) {
    return 0;
  }

  const start = new Date();
  target.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);

  const days = Math.ceil((target.getTime() - start.getTime()) / 86400000);
  return Number.isFinite(days) && days > 0 ? days : 0;
}

function setDetailRows(container, rows) {
  container.textContent = "";

  rows.forEach(([label, value]) => {
    const term = document.createElement("dt");
    const description = document.createElement("dd");

    term.textContent = label;
    description.textContent = formatDetailValue(value);
    container.append(term, description);
  });
}

function getFilteredPatients(patients) {
  const searchTerm = patientSearch.value.trim().toLowerCase();
  const selectedDate = dateFilter.value;
  const nameTerm = nameFilter.value.trim().toLowerCase();
  const phoneTerm = normalizeDigits(phoneFilter.value);

  return patients.filter((patient) => {
    const matchesSearch = !searchTerm || getSearchText(patient).includes(searchTerm);
    const matchesDate = !selectedDate || getPatientDate(patient) === selectedDate;
    const matchesName = !nameTerm || String(patient.name || "").toLowerCase().includes(nameTerm);
    const matchesPhone = !phoneTerm || normalizeDigits(patient.phone).includes(phoneTerm);

    return matchesSearch && matchesDate && matchesName && matchesPhone;
  });
}

function hasActiveFilters() {
  return Boolean(
    patientSearch.value.trim() ||
      dateFilter.value ||
      nameFilter.value.trim() ||
      phoneFilter.value.trim()
  );
}

function updateMetrics(patients) {
  const showedCount = patients.filter((patient) => patient.appointment_status === "showed").length;
  const pendingCount = patients.filter((patient) =>
    ["confirmed", "rescheduled"].includes(patient.appointment_status || "confirmed")
  ).length;

  activeMetric.textContent = patients.length;
  showedMetric.textContent = showedCount;
  pendingMetric.textContent = pendingCount;
}

function updateTodayLabel() {
  todayLabel.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(new Date());
}

function handleUnauthorized() {
  localStorage.removeItem("doctor_dashboard_token");
  window.location.href = "/";
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {})
    }
  });

  const data = await response.json();

  if (response.status === 401) {
    handleUnauthorized();
    return data;
  }

  if (!response.ok) {
    throw new Error(data.message || "Request failed.");
  }

  return data;
}

function toDateInputValue(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function addDateDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function setReportPeriodDates(period) {
  const today = new Date();
  const currentStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const currentEnd = today;
  let start = addDateDays(today, -6);
  let end = today;

  if (period === "15") {
    start = addDateDays(today, -14);
  }

  if (period === "this_month") {
    start = currentStart;
    end = currentEnd;
  }

  if (period === "last_month") {
    start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    end = new Date(today.getFullYear(), today.getMonth(), 0);
  }

  if (period !== "custom") {
    reportStartDate.value = toDateInputValue(start);
    reportEndDate.value = toDateInputValue(end);
  }
}

function getReportQueryString() {
  return new URLSearchParams({
    start: reportStartDate.value,
    end: reportEndDate.value
  }).toString();
}

function renderReport(report) {
  reportPreview.hidden = false;
  reportNewPatients.textContent = report.totals.newPatients;
  reportShowRate.textContent = `${report.rates.showRate}%`;
  reportNoShow.textContent = report.totals.noShows;
  reportFollowups.textContent = report.totals.followupRequired;
  reportForms.textContent = report.totals.formsSubmitted;

  reportInsights.textContent = "";
  report.insights.forEach((insight) => {
    const item = document.createElement("li");
    item.textContent = insight;
    reportInsights.appendChild(item);
  });
}

async function generateReport() {
  if (!reportStartDate.value || !reportEndDate.value) {
    setReportMessage("Choose report dates.");
    return;
  }

  setReportMessage("Generating report...");

  try {
    const data = await apiRequest(`/reports/summary?${getReportQueryString()}`);
    renderReport(data.report);
    setReportMessage(`Report ready for ${data.report.period.label}.`);
  } catch (error) {
    setReportMessage(error.message);
  }
}

async function downloadReportPdf() {
  if (!reportStartDate.value || !reportEndDate.value) {
    setReportMessage("Choose report dates.");
    return;
  }

  setReportMessage("Preparing PDF...");

  try {
    const response = await fetch(`/reports/pdf?${getReportQueryString()}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (response.status === 401) {
      handleUnauthorized();
      return;
    }

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || "Unable to download PDF.");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `clinic-report-${reportStartDate.value}-to-${reportEndDate.value}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setReportMessage("PDF downloaded.");
  } catch (error) {
    setReportMessage(error.message);
  }
}

function renderEmptyState() {
  patientList.textContent = "";
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = hasActiveFilters()
    ? "No patients match your search."
    : currentView === "completed"
      ? "No treated patients yet."
      : "No active patients.";
  patientList.appendChild(empty);
}

function populatePatientDetails(patient) {
  const followupRequired = getEffectiveFollowupRequired(patient);
  const reminderRequired = getEffectiveReminderRequired(patient);
  const followupDays = patient.followup_days || getFollowupDaysFromDate(patient.followup_date);

  detailTitle.textContent = patient.name || "Patient";
  detailSubtitle.textContent = patient.phone || "";

  setDetailRows(visitDetails, [
    ["Phone", patient.phone],
    ["Queue status", formatStatus(patient.status)],
    ["Appointment status", formatAppointmentStatus(patient.appointment_status)],
    ["Date of join", formatDateTime(patient.join_time || patient.createdAt)],
    ["Last updated", formatDateTime(patient.updatedAt)],
    ["Last form submission", formatDateTime(patient.last_form_submission_at)]
  ]);

  setDetailRows(followupDetails, [
    ["Follow-up required", formatYesNo(followupRequired)],
    ["Follow-up days", followupRequired ? followupDays : 0],
    ["Next date", followupRequired ? formatDateOnly(patient.followup_date) : "Not set"],
    ["Medication reminder needed", formatYesNo(reminderRequired)],
    ["Notes", patient.notes]
  ]);

  const rawFormRows = getVisibleFormRows(patient.consultation_details || {}, {
    excludeLabels: SUMMARY_FORM_LABELS
  });
  const visibleFormRows = rawFormRows.length > 0
    ? rawFormRows
    : [["Additional form data", patient.last_form_submission_at ? "No extra fields" : "Not submitted yet"]];
  setDetailRows(formDetails, visibleFormRows);
}

function openPatientDetails(patient) {
  selectedPatientPhone = patient.phone || "";
  populatePatientDetails(patient);

  detailOverlay.hidden = false;
  patientDetail.hidden = false;
  document.body.classList.add("detail-open");
  closeDetailButton.focus();
}

function closePatientDetails() {
  selectedPatientPhone = "";
  detailOverlay.hidden = true;
  patientDetail.hidden = true;
  document.body.classList.remove("detail-open");
}

function renderPatients(patients) {
  patientList.textContent = "";
  if (currentSection === "patients") {
    viewTitle.textContent = currentView === "completed" ? "Already Treated Patients" : "Active Patients";
    queueCount.textContent = currentView === "completed" ? `${patients.length} treated` : `${patients.length} active`;
  }
  updateMetrics(patients);

  const visiblePatients = getFilteredPatients(patients);

  if (visiblePatients.length === 0) {
    renderEmptyState();
    return;
  }

  visiblePatients.forEach((patient) => {
    const node = patientTemplate.content.cloneNode(true);
    const card = node.querySelector(".patient-card");
    const avatar = node.querySelector(".patient-avatar");
    const position = node.querySelector(".position");
    const name = node.querySelector(".patient-name");
    const phone = node.querySelector(".patient-phone");
    const joinDate = node.querySelector(".join-date");
    const queueStatus = node.querySelector(".queue-pill");
    const followupChip = node.querySelector(".followup-chip");
    const appointmentBadge = node.querySelector(".appointment-badge");
    const appointmentStatus = node.querySelector(".appointment-status-select");
    const completeButton = node.querySelector(".complete-button");
    const doneButton = node.querySelector(".done-button");

    card.dataset.phone = patient.phone;
    card.dataset.name = patient.name;
    card.dataset.queueStatus = patient.status;
    card.dataset.appointmentStatus = patient.appointment_status || "confirmed";
    avatar.textContent = getInitials(patient.name);
    position.textContent = `No. ${patient.position}`;
    name.textContent = patient.name;
    name.title = "Open patient details";
    phone.textContent = patient.phone;
    joinDate.textContent = `Joined ${formatDateOnly(patient.join_time || patient.createdAt)}`;
    queueStatus.textContent = formatStatus(patient.status);
    queueStatus.dataset.status = patient.status;
    const followupRequired = getEffectiveFollowupRequired(patient);
    followupChip.textContent = followupRequired ? "Follow-up: Yes" : "Follow-up: No";
    followupChip.dataset.active = followupRequired ? "true" : "false";
    appointmentBadge.textContent = formatAppointmentStatus(patient.appointment_status);
    appointmentBadge.dataset.status = patient.appointment_status || "confirmed";
    appointmentStatus.value = patient.appointment_status || "confirmed";
    appointmentStatus.dataset.previousValue = appointmentStatus.value;
    appointmentStatus.dataset.status = appointmentStatus.value;

    name.addEventListener("click", () => {
      openPatientDetails(patient);
    });

    // Appointment status is handled by this dropdown. When "Showed" is chosen,
    // the backend is updated and the GHL consultation form is opened separately.
    appointmentStatus.addEventListener("change", () => {
      updateAppointmentStatus(card, appointmentStatus);
    });

    completeButton.addEventListener("click", () => {
      startConsultation(card, completeButton);
    });

    doneButton.addEventListener("click", () => {
      markTreatmentDone(card);
    });

    if (currentView === "completed") {
      card.classList.add("is-completed");
      position.textContent = "Done";
      appointmentStatus.disabled = true;
      completeButton.disabled = true;
      doneButton.disabled = true;
      doneButton.textContent = "Treatment Completed";
    }

    patientList.appendChild(node);
  });
}

async function fetchPatients() {
  if (isFetchingPatients) {
    return;
  }

  isFetchingPatients = true;
  setMessage("Loading patients...");

  try {
    const data = await apiRequest(`/patients?view=${encodeURIComponent(currentView)}`);
    patientCache = data.patients || [];
    renderPatients(patientCache);

    if (selectedPatientPhone) {
      const selectedPatient = patientCache.find((patient) => patient.phone === selectedPatientPhone);
      if (selectedPatient) {
        populatePatientDetails(selectedPatient);
      }
    }

    setMessage("");
  } catch (error) {
    setMessage(error.message);
  } finally {
    isFetchingPatients = false;
  }
}

function setCurrentView(view) {
  currentView = view;
  activeViewButton.classList.toggle("is-active", currentView === "active");
  treatedViewButton.classList.toggle("is-active", currentView === "completed");
  patientSearch.value = "";
  clearDetailedFilters();
  fetchPatients();
}

function clearDetailedFilters() {
  dateFilter.value = "";
  nameFilter.value = "";
  phoneFilter.value = "";
}

function clearAllFilters() {
  patientSearch.value = "";
  clearDetailedFilters();
  renderPatients(patientCache);
}

function buildConsultationFormUrl(card) {
  const url = new URL(CONSULTATION_FORM_URL);
  url.searchParams.set("phone", card.dataset.phone || "");
  url.searchParams.set("name", card.dataset.name || "");
  return url.toString();
}

function openConsultationForm(card) {
  // This dashboard only redirects to the existing GHL form. GHL handles the
  // form submission and the workflow that follows it.
  window.open(buildConsultationFormUrl(card), "_blank", "noopener,noreferrer");
}

function syncAppointmentStatusUi(card, status) {
  card.dataset.appointmentStatus = status;

  const select = card.querySelector(".appointment-status-select");
  if (select) {
    select.value = status;
    select.dataset.previousValue = status;
    select.dataset.status = status;
  }

  const badge = card.querySelector(".appointment-badge");
  if (badge) {
    badge.textContent = formatAppointmentStatus(status);
    badge.dataset.status = status;
  }
}

async function saveAppointmentStatus(card, status) {
  const data = await apiRequest("/update-status", {
    method: "POST",
    body: JSON.stringify({
      phone: card.dataset.phone,
      appointment_status: status
    })
  });

  syncAppointmentStatusUi(card, status);
  return data;
}

async function startConsultation(card, button) {
  const previousText = button.textContent;
  button.disabled = true;
  setMessage("Marking patient as showed...");

  try {
    const data = await saveAppointmentStatus(card, "showed");
    openConsultationForm(card);

    if (data.ghl && data.ghl.sent === false) {
      setMessage("Consultation opened. GHL webhook was not sent.");
    } else {
      setMessage("Consultation opened and status changed to showed.");
    }
  } catch (error) {
    setMessage(error.message);
  } finally {
    button.disabled = false;
    button.textContent = previousText;
  }
}

async function updateAppointmentStatus(card, select) {
  const previousValue = select.dataset.previousValue || "confirmed";
  const nextValue = select.value;

  select.disabled = true;
  select.dataset.status = nextValue;

  if (nextValue === "showed") {
    openConsultationForm(card);
  }

  setMessage(`Updating appointment status to ${formatAppointmentStatus(nextValue)}...`);

  try {
    const data = await saveAppointmentStatus(card, nextValue);

    if (data.ghl && data.ghl.sent === false) {
      setMessage("Appointment status updated. GHL webhook was not sent.");
    } else {
      setMessage("Appointment status updated.");
    }

  } catch (error) {
    select.value = previousValue;
    select.dataset.status = previousValue;
    setMessage(error.message);
  } finally {
    select.disabled = false;
  }
}

async function markTreatmentDone(card) {
  const confirmed = window.confirm("Mark this patient's treatment as done and move them out of the active queue?");

  if (!confirmed) {
    return;
  }

  setMessage("Completing treatment...");

  try {
    const data = await apiRequest("/update", {
      method: "POST",
      body: JSON.stringify({
        phone: card.dataset.phone,
        status: "completed"
      })
    });

    if (data.ghl && data.ghl.sent === false) {
      setMessage("Treatment completed. GHL webhook was not sent.");
    } else {
      setMessage("Treatment completed.");
    }

    await fetchPatients();
  } catch (error) {
    setMessage(error.message);
  }
}

refreshButton.addEventListener("click", fetchPatients);
patientsSectionButton.addEventListener("click", () => setDashboardSection("patients"));
reportsSectionButton.addEventListener("click", () => setDashboardSection("reports"));
activeViewButton.addEventListener("click", () => setCurrentView("active"));
treatedViewButton.addEventListener("click", () => setCurrentView("completed"));
patientSearch.addEventListener("input", () => renderPatients(patientCache));
dateFilter.addEventListener("input", () => renderPatients(patientCache));
nameFilter.addEventListener("input", () => renderPatients(patientCache));
phoneFilter.addEventListener("input", () => renderPatients(patientCache));
clearFiltersButton.addEventListener("click", clearAllFilters);
closeDetailButton.addEventListener("click", closePatientDetails);
detailOverlay.addEventListener("click", closePatientDetails);
reportPeriod.addEventListener("change", () => {
  setReportPeriodDates(reportPeriod.value);
});
reportStartDate.addEventListener("input", () => {
  reportPeriod.value = "custom";
});
reportEndDate.addEventListener("input", () => {
  reportPeriod.value = "custom";
});
generateReportButton.addEventListener("click", generateReport);
downloadReportButton.addEventListener("click", downloadReportPdf);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !patientDetail.hidden) {
    closePatientDetails();
  }
});

window.addEventListener("focus", fetchPatients);
window.setInterval(fetchPatients, 30000);

logoutButton.addEventListener("click", () => {
  localStorage.removeItem("doctor_dashboard_token");
  window.location.href = "/";
});

updateTodayLabel();
setReportPeriodDates(reportPeriod.value);
fetchPatients();
