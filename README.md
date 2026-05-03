# Doctor Dashboard System

Full-stack doctor dashboard using Node.js, Express, MongoDB with Mongoose, JWT authentication, and plain HTML/CSS/JavaScript.

## Features

- Doctor login with bcrypt-hashed passwords
- JWT-protected dashboard APIs
- Patient queue with waiting, in-progress, and completed states
- Appointment status tracking: confirmed, showed, no show, rescheduled, cancelled
- GHL webhook intake for appointment bookings
- Backend webhook call back to GHL when the doctor updates a patient
- Consultation form redirect with patient name and phone query parameters
- Consultation form detail storage for notes, follow-up, reminder, and next-date fields
- Clinic reporting with custom date ranges and PDF downloads
- Automatic monthly report email for the previous month
- Plain HTML/CSS/JavaScript frontend served by Express

## Project Structure

```text
server.js
models/
  Doctor.js
  Patient.js
middleware/
  auth.js
scripts/
  createDoctor.js
public/
  index.html
  dashboard.html
  login.js
  dashboard.js
  styles.css
.env.example
package.json
```

## Environment Variables

Create a `.env` file in the project root:

```env
MONGO_URI=mongodb://127.0.0.1:27017/doctor_dashboard
JWT_SECRET=replace_with_a_long_random_secret
GHL_WEBHOOK_URL=https://services.leadconnectorhq.com/hooks/your-ghl-webhook-url
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=doctor@example.com
SMTP_PASS=your_smtp_password
SMTP_FROM=doctor@example.com
MONTHLY_REPORT_TO_EMAIL=doctor@example.com
```

## Setup Instructions

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` using `.env.example`:

   - Add your MongoDB connection string.
   - Add a long random JWT secret.
   - Add your GHL incoming webhook URL for backend-to-GHL updates.
   - Add SMTP settings if you want automatic monthly report emails.

3. Create the doctor login account:

   ```bash
   npm run create-doctor -- doctor@example.com StrongPassword123
   ```

4. Start the server:

   ```bash
   node server.js
   ```

5. Open the frontend:

   ```text
   http://localhost:3000
   ```

6. Log in with the doctor email and password created in step 3.

## GHL Setup

### Workflow 1: GHL to Backend

Create a GHL workflow:

- Trigger: Appointment booked
- Action: Webhook
- Method: POST
- URL: `https://your-domain.com/add`

Payload:

```json
{
  "name": "{{contact.first_name}} {{contact.last_name}}",
  "phone": "{{contact.phone}}"
}
```

For local testing, expose your local server with a tunnel such as ngrok and use the public tunnel URL:

```text
https://your-ngrok-url.ngrok-free.app/add
```

### Workflow 2: Backend to GHL

Create another GHL workflow:

- Trigger: Incoming Webhook
- Copy the generated webhook URL into `GHL_WEBHOOK_URL`
- Actions:
  - Update contact fields
  - Send WhatsApp or SMS
  - Trigger follow-up automation

Payload sent by this backend:

```json
{
  "phone": "+15551234567",
  "appointment_status": "showed"
}
```

When `appointment_status` is `showed`, the dashboard opens the existing GHL consultation form in a new tab with prefilled query params:

```text
https://brand.ariesmediacompany.com/widget/form/TNnFV59elnOAmxzym3jv?phone=%2B15551234567&name=Jane+Patient
```

GHL owns the form, and the dashboard can receive the submitted values through the `/consultation` webhook route below.

To show submitted consultation fields inside the dashboard, add a GHL workflow after the form is submitted:

- Trigger: Form submitted
- Action: Webhook
- Method: POST
- URL: `https://your-domain.com/consultation`

Send at least the patient phone plus any form fields you want stored:

```json
{
  "phone": "+15551234567",
  "notes": "Patient needs a follow-up consultation.",
  "followup_required": true,
  "followup_days": 7,
  "followup_date": "2026-05-10",
  "reminder_required": true,
  "reminder_date": "2026-05-09T10:00:00.000Z"
}
```

## API Reference

### POST `/auth/login`

Request:

```json
{
  "email": "doctor@example.com",
  "password": "StrongPassword123"
}
```

Response:

```json
{
  "token": "jwt_token_here",
  "doctor": {
    "id": "doctor_id",
    "email": "doctor@example.com"
  }
}
```

### POST `/add`

Called by GHL when an appointment is booked.

Request:

```json
{
  "name": "Jane Patient",
  "phone": "+15551234567"
}
```

Patients added by this route get:

```json
{
  "status": "waiting",
  "appointment_status": "confirmed"
}
```

### GET `/patients`

Protected route. Requires:

```text
Authorization: Bearer jwt_token_here
```

Returns all patients where `status != completed`, sorted by `position`.

### POST `/update-status`

Protected route. Requires:

```text
Authorization: Bearer jwt_token_here
```

Called by the dashboard appointment status dropdown.

Request:

```json
{
  "phone": "+15551234567",
  "appointment_status": "showed"
}
```

Allowed `appointment_status` values:

```text
confirmed
showed
no_show
rescheduled
cancelled
```

This route saves `appointment_status` in MongoDB and sends this payload to GHL:

```json
{
  "phone": "+15551234567",
  "appointment_status": "showed"
}
```

### POST `/update`

Protected route. Requires:

```text
Authorization: Bearer jwt_token_here
```

Request:

```json
{
  "phone": "+15551234567",
  "appointment_status": "confirmed",
  "status": "completed",
  "followup_required": true,
  "followup_days": 7,
  "notes": "Patient needs a follow-up consultation."
}
```

When `status` is `completed`, the backend shifts remaining active patient positions down by one and posts the same update payload to GHL.

### POST `/consultation`

Public route for GHL form-submission workflows. It finds the patient by `phone`, stores notes, follow-up, reminder, next-date fields, and keeps the full submitted form payload in `consultation_details`.

### GET `/reports/summary`

Protected route. Generates clinic metrics for a date range:

```text
/reports/summary?start=2026-05-01&end=2026-05-15
```

The dashboard uses this for the report preview.

### GET `/reports/pdf`

Protected route. Downloads the same clinic report as a PDF:

```text
/reports/pdf?start=2026-05-01&end=2026-05-15
```

### Monthly Report Email

On the 1st day of every month, the server generates a report for the previous month and emails it as a PDF. Configure SMTP values in `.env`. If `MONTHLY_REPORT_TO_EMAIL` is empty, the app sends to doctor emails stored in MongoDB.
