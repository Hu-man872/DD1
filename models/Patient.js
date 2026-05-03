const mongoose = require("mongoose");

const patientSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    status: {
      type: String,
      enum: ["waiting", "in_progress", "completed"],
      default: "waiting"
    },
    appointment_status: {
      type: String,
      enum: ["confirmed", "showed", "no_show", "rescheduled", "cancelled"],
      default: "confirmed"
    },
    position: {
      type: Number,
      required: true
    },
    join_time: {
      type: Date,
      default: Date.now
    },
    notes: {
      type: String,
      default: "",
      trim: true
    },
    followup_required: {
      type: Boolean,
      default: false
    },
    followup_days: {
      type: Number,
      default: 0,
      min: 0
    },
    followup_date: {
      type: Date,
      default: null
    },
    reminder_required: {
      type: Boolean,
      default: false
    },
    reminder_date: {
      type: Date,
      default: null
    },
    consultation_details: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    last_form_submission_at: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Patient", patientSchema);
