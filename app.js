'use strict';

const { join } = require("path");

// setup logger
require("./managers/LoggingManager").createLogger(join(__dirname, "config", "logs", "settings.json"));

// setup server
const ServerManager = require("./managers/ServerManager");
const { critical } = require("./managers/LoggingManager");
const serverManager = new ServerManager(443);
serverManager.setSettingsDir(join(__dirname, "config", "server"));

// set up db
require("./managers/DatabaseManager").init(join(__dirname, "databases", "db.sqlite"));

// set up stuff for pug
serverManager.app.locals.basedir = join(__dirname, "views");
process.pugBaseDir = join(__dirname, "views");

// setup routes + no vhosts
serverManager.addRouteDirectory(join(__dirname, "routes"));

// and gooooooo
serverManager.setupFromState();

// ------ errors --------
// 500
serverManager.app.use((err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }

    res.status(500);
    critical(err);
});

// console interface for debugging if debug mode is on
// disabled when debug is off for security
if (require("./config/server/meta.json").debugMode) {
    const readline = require("readline");
    var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    rl.on("line", async line => {
        try {
            let eresult = eval(line);
            console.log(eresult);
        } catch (err) {
            console.error(err);
        }
    })
}

// and actually goooooo
serverManager.start();