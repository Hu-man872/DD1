const mongoose = require("mongoose");

const reportDeliverySchema = new mongoose.Schema(
  {
    report_key: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    period_start: {
      type: Date,
      required: true
    },
    period_end: {
      type: Date,
      required: true
    },
    recipients: {
      type: [String],
      default: []
    },
    status: {
      type: String,
      enum: ["sent", "failed"],
      default: "sent"
    },
    error: {
      type: String,
      default: ""
    },
    sent_at: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("ReportDelivery", reportDeliverySchema);
