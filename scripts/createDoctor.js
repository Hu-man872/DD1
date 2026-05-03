require("dotenv").config();

const mongoose = require("mongoose");
const Doctor = require("../models/Doctor");

async function main() {
  const [, , emailArg, passwordArg] = process.argv;
  const email = String(emailArg || "").trim().toLowerCase();
  const password = String(passwordArg || "");

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is required in .env");
  }

  if (!email || !password) {
    throw new Error("Usage: npm run create-doctor -- doctor@example.com strongPassword123");
  }

  await mongoose.connect(process.env.MONGO_URI);

  let doctor = await Doctor.findOne({ email }).select("+password");
  if (doctor) {
    doctor.password = password;
    await doctor.save();
    console.log(`Updated password for doctor: ${email}`);
  } else {
    doctor = await Doctor.create({ email, password });
    console.log(`Created doctor: ${doctor.email}`);
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect();
  process.exit(1);
});
