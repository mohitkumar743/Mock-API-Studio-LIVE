require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const os = require("os");
const mongoose = require("mongoose");

/* FIX for open (ESM support) */
const openBrowser = async (url) => {
    const open = (await import("open")).default;
    open(url);
};

const app = express();
const PORT = process.env.PORT || 5000;

/* =====================================
   MONGODB CONNECTION
===================================== */

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("Mongo Error:", err));

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

/* Unique per guest */
mockApiSchema.index(
    { guestId: 1, method: 1, route: 1 },
    { unique: true }
);

const MockAPI = mongoose.model("MOCKAPI", mockApiSchema);

/* =====================================
   PATH HANDLING
===================================== */

const basePath = process.pkg
    ? path.dirname(process.execPath)
    : __dirname;

const PUBLIC_DIR = process.pkg
    ? path.join(__dirname, "public")
    : path.join(basePath, "public");

/* =====================================
   MIDDLEWARE
===================================== */

app.use(cors());
app.use(express.json());

/* =====================================
   ROOT ROUTES
===================================== */

app.get("/", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "landingindex.html"));
});

app.get("/start", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/dist/style.css", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "dist/style.css"));
});

/* =====================================
   CREATE ROUTE
===================================== */

app.post("/api/create", async (req, res) => {

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
   LIST ROUTES (Header Required)
===================================== */

app.get("/api/list", async (req, res) => {

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

    try {

        const guestId = req.params.guestId;
        const method = req.method.toUpperCase();

        // Extract real route
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

        if (mockRoute.delay > 0) {
            await new Promise(resolve =>
                setTimeout(resolve, mockRoute.delay)
            );
        }

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
   START SERVER
===================================== */

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === "IPv4" && !iface.internal) {
                return iface.address;
            }
        }
    }
    return "localhost";
}

app.listen(PORT, "0.0.0.0", async () => {

    const localIP = getLocalIP();

    console.log("🚀 Mock API Studio Running");
    console.log(`Local:   http://localhost:${PORT}`);
    console.log(`Network: http://${localIP}:${PORT}`);

    try {
        await openBrowser(`http://localhost:${PORT}`);
    } catch {
        console.log("Browser auto-open failed.");
    }
});