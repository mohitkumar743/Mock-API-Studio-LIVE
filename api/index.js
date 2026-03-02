import express from "express";
import mongoose from "mongoose";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

/* =====================================
   MONGODB CACHED CONNECTION (Vercel Safe)
===================================== */

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGO_URI);
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

/* =====================================
   SCHEMA (Guest Based)
===================================== */

const mockApiSchema = new mongoose.Schema({
  guestId: {
    type: String,
    required: true,
    index: true
  },
  method: {
    type: String,
    required: true,
    uppercase: true
  },
  route: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: Number,
    default: 200
  },
  body: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  headers: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  delay: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

mockApiSchema.index(
  { guestId: 1, method: 1, route: 1 },
  { unique: true }
);

const MockAPI =
  mongoose.models.MOCKAPI ||
  mongoose.model("MOCKAPI", mockApiSchema);

/* =====================================
   CREATE ROUTE
===================================== */

app.post("/api/create", async (req, res) => {

  await connectDB();

  const { guestId, method, route, status, body, headers, delay } = req.body;

  if (!guestId || !method || !route) {
    return res.status(400).json({
      message: "guestId, method, route required"
    });
  }

  try {

    const newRoute = await MockAPI.create({
      guestId,
      method: method.toUpperCase(),
      route,
      status: parseInt(status) || 200,
      body: body || {},
      headers: headers || {},
      delay: delay || 0
    });

    res.json({
      message: "Route Created Successfully",
      data: newRoute
    });

  } catch (err) {

    if (err.code === 11000) {
      return res.status(400).json({
        message: "Route already exists for this guest"
      });
    }

    res.status(500).json({
      message: "Error Creating Route",
      error: err.message
    });
  }
});

/* =====================================
   LIST ROUTES
===================================== */

app.get("/api/list", async (req, res) => {

  await connectDB();

  const guestId = req.headers["x-guest-id"];

  if (!guestId) {
    return res.status(400).json({
      message: "x-guest-id header required"
    });
  }

  try {
    const routes = await MockAPI.find({ guestId });
    res.json(routes);
  } catch (err) {
    res.status(500).json({
      message: "Error Fetching Routes"
    });
  }
});

/* =====================================
   UPDATE ROUTE
===================================== */

app.put("/api/update", async (req, res) => {

  await connectDB();

  const { guestId, method, route, status, body, headers, delay, isActive } = req.body;

  if (!guestId || !method || !route) {
    return res.status(400).json({
      message: "guestId, method, route required"
    });
  }

  try {

    const updated = await MockAPI.findOneAndUpdate(
      { guestId, method: method.toUpperCase(), route },
      {
        status: parseInt(status) || 200,
        body: body || {},
        headers: headers || {},
        delay: delay || 0,
        isActive: isActive ?? true
      },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ message: "Route Not Found" });
    }

    res.json({
      message: "Route Updated Successfully",
      data: updated
    });

  } catch (err) {
    res.status(500).json({
      message: "Error Updating Route",
      error: err.message
    });
  }
});

/* =====================================
   DELETE ROUTE
===================================== */

app.delete("/api/delete", async (req, res) => {

  await connectDB();

  const { guestId, method, route } = req.body;

  if (!guestId || !method || !route) {
    return res.status(400).json({
      message: "guestId, method, route required"
    });
  }

  try {

    const deleted = await MockAPI.findOneAndDelete({
      guestId,
      method: method.toUpperCase(),
      route
    });

    if (!deleted) {
      return res.status(404).json({ message: "Route Not Found" });
    }

    res.json({
      message: "Route Deleted Successfully"
    });

  } catch (err) {
    res.status(500).json({
      message: "Error Deleting Route",
      error: err.message
    });
  }
});

/* =====================================
   PUBLIC MOCK ROUTE (NO HEADER REQUIRED)
===================================== */

app.use("/mock/:guestId", async (req, res) => {

  await connectDB();

  try {

    const guestId = req.params.guestId;
    const method = req.method.toUpperCase();

    const route = req.originalUrl
      .replace(`/mock/${guestId}`, "")
      .split("?")[0];

    const mockRoute = await MockAPI.findOne({
      guestId,
      method,
      route,
      isActive: true
    });

    if (!mockRoute) {
      return res.status(404).json({
        message: "Mock Route Not Found"
      });
    }

    /* Delay Simulation */
    if (mockRoute.delay > 0) {
      await new Promise(resolve =>
        setTimeout(resolve, mockRoute.delay)
      );
    }

    /* Custom Headers */
    if (mockRoute.headers) {
      Object.entries(mockRoute.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
    }

    res.status(mockRoute.status).json(mockRoute.body);

  } catch (err) {
    res.status(500).json({
      message: "Mock Server Error",
      error: err.message
    });
  }
});

/* =====================================
   EXPORT FOR VERCEL
===================================== */

export default app;