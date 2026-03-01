const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const os = require("os");

// FIX for open (ESM support)
const openBrowser = async (url) => {
    const open = (await import("open")).default;
    open(url);
};

const app = express();
const PORT = 5000;

/* =====================================
   PATH HANDLING (EXE SAFE)
===================================== */

const basePath = process.pkg
    ? path.dirname(process.execPath)
    : __dirname;

const ROUTES_DIR = path.join(basePath, "routes");
const LOGS_DIR = path.join(basePath, "logs");

const PUBLIC_DIR = process.pkg
    ? path.join(__dirname, "public")
    : path.join(basePath, "public");

const CSV_LOG_FILE = path.join(LOGS_DIR, "audit_logs.csv");

/* =====================================
   INIT FOLDERS
===================================== */

if (!fs.existsSync(ROUTES_DIR)) fs.mkdirSync(ROUTES_DIR);
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR);

if (!fs.existsSync(CSV_LOG_FILE)) {
    fs.writeFileSync(
        CSV_LOG_FILE,
        "Timestamp,Action,GuestID,Method,Route,Status,IP\n"
    );
}

/* =====================================
   MIDDLEWARE
===================================== */

app.use(cors());
app.use(express.json());

/* =====================================
   ROOT ROUTE
===================================== */

app.get("/", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "landingindex.html"));
});

app.get("/start", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/dist/style.css", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "/dist/style.css"));
});


app.get("/downloadexe", (req, res) => {
    const filePath = path.join(PUBLIC_DIR, "mock-api-studio.exe");

    res.download(filePath, "mock-api-studio.exe", (err) => {
        if (err) {
            console.error("Download error:", err);
            res.status(500).send("File not found");
        }
    });
});

/* =====================================
   UTIL FUNCTIONS
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

function writeLog({ action, guestId = "", method = "", route = "", status = "", ip = "" }) {
    const timestamp = new Date().toISOString();
    const row = `"${timestamp}","${action}","${guestId}","${method}","${route}","${status}","${ip}"\n`;

    fs.appendFile(CSV_LOG_FILE, row, (err) => {
        if (err) console.error("Log Write Error:", err.message);
    });
}

/* =====================================
   CREATE ROUTE
===================================== */

app.post("/api/create", (req, res) => {
    const { guestId, method, route, status, body } = req.body;
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

    if (!guestId || !method || !route) {
        return res.status(400).json({ message: "GuestID, Method & Route required" });
    }

    try {
        const routeParts = route.split("/").filter(Boolean);

        const dirPath = path.join(
            ROUTES_DIR,
            `guest_${guestId}`,
            ...routeParts
        );

        fs.mkdirSync(dirPath, { recursive: true });

        const filePath = path.join(dirPath, `${method.toUpperCase()}.json`);
        const validStatus = parseInt(status) || 200;

        fs.writeFileSync(
            filePath,
            JSON.stringify({ status: validStatus, body: body || {} }, null, 2)
        );

        writeLog({
            action: "ROUTE_CREATED",
            guestId,
            method,
            route,
            status: validStatus,
            ip
        });

        res.json({ message: "Route Created Successfully" });

    } catch (err) {
        res.status(500).json({ message: "Error Creating Route", error: err.message });
    }
});

/* =====================================
   LIST ROUTES
===================================== */

app.get("/api/list", (req, res) => {

    const guestId = req.headers["x-guest-id"];
    const guestDir = path.join(ROUTES_DIR, `guest_${guestId}`);
    const routes = [];

    function scan(dir, base = "") {
        if (!fs.existsSync(dir)) return;

        const items = fs.readdirSync(dir);

        items.forEach(item => {
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                scan(fullPath, base + "/" + item);
            } else if (item.endsWith(".json")) {
                routes.push({
                    method: item.replace(".json", ""),
                    route: base
                });
            }
        });
    }

    scan(guestDir);
    res.json(routes);
});

/* =====================================
   UPDATE ROUTE
===================================== */

app.put("/api/update", (req, res) => {

    const { guestId, method, route, status, body } = req.body;
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

    if (!guestId || !method || !route) {
        return res.status(400).json({ message: "GuestID, Method & Route required" });
    }

    try {
        const filePath = path.join(
            ROUTES_DIR,
            `guest_${guestId}`,
            ...route.split("/").filter(Boolean),
            `${method.toUpperCase()}.json`
        );

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ message: "Route Not Found" });
        }

        const validStatus = parseInt(status) || 200;

        fs.writeFileSync(
            filePath,
            JSON.stringify({ status: validStatus, body: body || {} }, null, 2)
        );

        writeLog({
            action: "ROUTE_UPDATED",
            guestId,
            method,
            route,
            status: validStatus,
            ip
        });

        res.json({ message: "Route Updated Successfully" });

    } catch (err) {
        res.status(500).json({ message: "Error Updating Route", error: err.message });
    }
});

/* =====================================
   DELETE ROUTE
===================================== */

app.delete("/api/delete", (req, res) => {

    const { guestId, method, route } = req.body;
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

    if (!guestId || !method || !route) {
        return res.status(400).json({ message: "GuestID, Method & Route required" });
    }

    try {
        const filePath = path.join(
            ROUTES_DIR,
            `guest_${guestId}`,
            ...route.split("/").filter(Boolean),
            `${method.toUpperCase()}.json`
        );

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ message: "Route Not Found" });
        }

        fs.unlinkSync(filePath);

        writeLog({
            action: "ROUTE_DELETED",
            guestId,
            method,
            route,
            ip
        });

        res.json({ message: "Route Deleted Successfully" });

    } catch (err) {
        res.status(500).json({ message: "Error Deleting Route", error: err.message });
    }
});

/* =====================================
   PUBLIC MOCK HANDLER
===================================== */

app.use("/mock/:guestId", (req, res) => {

    try {

        const { guestId } = req.params;
        const method = req.method.toUpperCase();
        const cleanPath = req.path;

        const filePath = path.join(
            ROUTES_DIR,
            `guest_${guestId}`,
            ...cleanPath.split("/").filter(Boolean),
            `${method}.json`
        );

        let statusCode = 404;
        let responseBody = { message: "Mock Route Not Found" };

        if (fs.existsSync(filePath)) {
            const fileData = JSON.parse(fs.readFileSync(filePath));
            statusCode = parseInt(fileData.status) || 200;
            responseBody = fileData.body || {};
        }

        res.status(statusCode).json(responseBody);

    } catch (err) {
        res.status(500).json({ message: "Mock Server Error", error: err.message });
    }
});

/* =====================================
   START SERVER
===================================== */

// app.listen(PORT, "0.0.0.0", async () => {

//     const localIP = getLocalIP();

//     console.log("🚀 Mock API Studio Running");
//     console.log(`Local:   http://localhost:${PORT}`);
//     console.log(`Network: http://${localIP}:${PORT}`);

//     // try {
//     //     await openBrowser(`http://localhost:${PORT}`);
//     // } catch {
//     //     console.log("Browser auto-open failed.");
//     // }
// });



app.listen(PORT, "0.0.0.0", async () => {

    const localIP = getLocalIP();

    console.clear();

     console.log(`
================================================================================

███╗   ███╗ ██████╗  ██████╗██╗  ██╗     █████╗ ██████╗ ██╗
████╗ ████║██╔═══██╗██╔════╝██║ ██╔╝    ██╔══██╗██╔══██╗██║
██╔████╔██║██║   ██║██║     █████╔╝     ███████║██████╔╝██║
██║╚██╔╝██║██║   ██║██║     ██╔═██╗     ██╔══██║██╔═══╝ ██║
██║ ╚═╝ ██║╚██████╔╝╚██████╗██║  ██╗    ██║  ██║██║     ██║
╚═╝     ╚═╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝    ╚═╝  ╚═╝╚═╝     ╚═╝

 ███████╗████████╗██╗   ██╗██████╗ ██╗ ██████╗ 
 ██╔════╝╚══██╔══╝██║   ██║██╔══██╗██║██╔═══██╗
 ███████╗   ██║   ██║   ██║██║  ██║██║██║   ██║
 ╚════██║   ██║   ██║   ██║██║  ██║██║██║   ██║
 ███████║   ██║   ╚██████╔╝██████╔╝██║╚██████╔╝
 ╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝ 

================================================================================

🚀 MOCK API STUDIO
💻 Developed By Mohit Kumar Instagram(the.mohit.kumar)

------------------------------------------------------------
Server Running Successfully
Local:   http://localhost:${PORT}
Network: http://${localIP}:${PORT}
------------------------------------------------------------
    `);

});
