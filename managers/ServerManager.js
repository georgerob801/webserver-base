'use strict';

const express = require("express");
const vhost = require("vhost");
const { debug, info, error, warn } = require("./LoggingManager");
const { isAbsolute, join } = require("path");
const https = require("https");
const { readFileSync, readdirSync, lstatSync } = require("fs");
const displayRoutes = require("express-routemap");

/**
 * Class for controlling the server.
 * @class
 * @constructor
 */
class ServerManager {
    /**
     * Array of directories to scan for vhost things.
     * @type {String[]}
     * @private
     */
    #vhostDirectories;
    /**
     * Port used to run the server.
     * @type {Number}
     * @private
     */
    #port;

    #routeDirectories;
    #staticDirectories;
    #useDirectories;
    #settingsDir;
    #httpsServer;

    #structure;

    constructor(port) {
        if (!port || typeof port != "number") throw new Error(`${port} is not a valid port.`);
        this.#vhostDirectories = [];
        this.#routeDirectories = [];
        this.#staticDirectories = [];
        this.#useDirectories = [];
        this.#port = port;
        /**
         * Express application used to run the server.
         * @type {express.Application}
         */
        this.app = express();

        this.app.set("view engine", "pug");
    }

    setupFromState() {
        let headers = require(join(this.#settingsDir, "headers.json"));
        if (headers.disable?.length) {
            for (const header of headers.disable) {
                this.app.disable(header);
            }
        }

        this.#loadVhosts();
        this.#loadRoutes(undefined, undefined, require(join(this.#settingsDir, "meta.json")).basehostname);
        this.#loadStatics();
    }

    #viewStructure(structure) {
        if (!structure) return;

        let output = "\n";

        output += this.#structureRecurse(structure);

        return output;
    }

    #structureRecurse(structure, indent) {
        if (!structure) return ""
        if (!indent) indent = 0;
        let output = "";
        output += `${"│ ".repeat(indent)}\x1b[31m├ ROUTER\t» ${structure.name} @ ${structure.path}\n`

        indent++;
        output += `${"│ ".repeat(indent)}\x1b[32m├ ROUTES ───\n`

        for (let i = 0; i < (structure.routeStack?.length || 0); i++) {
            output += `${"│ ".repeat(indent + 1)}${i != structure.routeStack?.length - 1 ? "├" : "└"} ${structure.routeStack[i].type != "use" ? "\x1b[35m" : "\x1b[34m"}${structure.routeStack[i].type.toUpperCase()}\t» (${structure.routeStack[i].priority}) ${structure.routeStack[i].methods?.map(x => x.toUpperCase()).join(", ") || ""} ${structure.routeStack[i].filename || structure.routeStack[i].name || structure.routeStack[i].type}${structure.routeStack[i].path ? `\t @ ${structure.routeStack[i].path}` : ""}\n`;
        }

        if (structure.children?.length) {
            output += `${"│ ".repeat(indent)}\x1b[32m├ ROUTERS ───\n`
            for (const child of structure.children) {
                output += this.#structureRecurse(child, indent);
            }
        }

        return output;
    }

    #getUses(dir, router) {
        let toLoad = [];
        if (typeof dir == "function") {
            toLoad.push({
                run: dir
            });

            return toLoad;
        }

        if (!this.#useDirectories.length && !dir) return this;

        let scanDirectories = dir ? [dir] : this.#routeDirectories;



        for (const dir of scanDirectories) {
            let files = readdirSync(dir);
            for (const filepath of files) {
                if (lstatSync(join(dir, filepath)).isDirectory()) {
                    this.#getUses(join(dir, filepath), router);
                }
                // ignore non-js files
                if (filepath.split(".").pop() !== "js") continue;

                let use;
                try {
                    use = require(join(dir, filepath));
                } catch (e) {
                    error(`Error while loading ${filepath}:\n${e}\n${e.stack}`);
                }

                if (!use.run) {
                    warn(`${filepath} has no function and so will be ignored`);
                    continue;
                }

                if (!use.priority) use.priority = 0;

                toLoad.push(use);
            }
        }

        toLoad.sort((a, b) => b.priority - a.priority);

        return toLoad;

        // for (const use of toLoad) {
        //     warn(use);
        //     (router ? router : this.app).use(use.run);
        // }
    }

    /**
     * Load routes from the current state.
     * @returns {ServerManager} This ServerManager.
     */
    #loadRoutes(dir, router, prefix, pathPrefix, routerID, innerLevel) {
        if (!this.#routeDirectories.length && !dir) return this;

        /** @type {RouteObject[]} */
        let toLoad = [];

        let scanDirectories = dir ? [dir] : this.#routeDirectories;

        if (!routerID) routerID = require("randomstring").generate(5);

        let structure = { 
            name: routerID, 
            path: `${prefix ? prefix : ""}${pathPrefix || ""}`, 
            children: [],
            routeStack: []
        }

        let scanAtPriority0 = [];

        for (const dir of scanDirectories) {
            let files = readdirSync(dir);
            for (const filepath of files) {
                // call again if is directory (recursuion yayyyyyy)
                if (lstatSync(join(dir, filepath)).isDirectory()) {
                    scanAtPriority0.push({
                        dir: dir,
                        filepath: filepath
                    });
                }
                // ignore non-js files
                if (filepath.split(".").pop() !== "js") continue;

                // else load
                /** @type {RouteObject} */
                let route;
                try {
                    route = require(join(dir, filepath));
                } catch (e) {
                    error(`Error while loading ${filepath}:\n${e}\n${e.stack}`);
                }

                if (!route.path) {
                    warn(`${filepath} does not have a path and so will be ignored`);
                    continue;
                }

                // if (pathPrefix) {
                //     route.path = pathPrefix + route.path;
                // }

                if (route.priority === undefined) {
                    info(`${filepath} does not have a set priority and so will be set to a priority of 0`);
                    route.priority = 0;
                }

                let validMethods = Object.keys(route.methods).filter(x => {
                    return [
                        "checkout",
                        "copy",
                        "delete",
                        "get",
                        "head",
                        "lock",
                        "merge",
                        "mkactivity",
                        "mkcol",
                        "move",
                        "m-search",
                        "notify",
                        "options",
                        "patch",
                        "post",
                        "purge",
                        "put",
                        "report",
                        "search",
                        "subscribe",
                        "trace",
                        "unlock",
                        "unsubscribe",
                        "all"
                    ].includes(x);
                });

                if (!validMethods.length) {
                    warn(`${filepath} does not have any method functions and so will be ignored`);
                    continue;
                }

                route.validMethods = validMethods;
                route.filename = filepath;

                toLoad.push(route);
            }
        }

        // load any local use things
        let allUses = [];
        for (const route of toLoad) {
            if (route.use?.length) {
                let fallbackPriority = route.startingUsePriority || -1;
                let specificPriorityIndex = 0;
                for (const use of route.use.flat()) {
                    let uses = this.#getUses(use);
                    for (let i = 0; i < uses.length; i++) {
                        uses[i].type = "use";
                        uses[i].priority = route.specificUsePriorities?.[specificPriorityIndex];
                        specificPriorityIndex++;
                        if (uses[i].priority === undefined) {
                            uses[i].priority = fallbackPriority;
                            fallbackPriority--;
                        }
                    }
                    allUses.push(...uses);
                }
            }
        }
        
        toLoad.push(...allUses);

        // sort routes by priority
        toLoad.sort((a, b) => b.priority - a.priority);
        
        // load them
        let dirScanned = false;
        if (!toLoad.length) {
            for (const e of scanAtPriority0) {
                let newRouter = express.Router();
                let newRouterID = require("randomstring").generate(5);

                let childStructure = this.#loadRoutes(join(e.dir, e.filepath), newRouter, prefix, pathPrefix ? `${pathPrefix}/${e.filepath}` : `/${e.filepath}`, newRouterID, true);

                structure.children.push(childStructure);

                info(`Attaching router ${newRouterID} to router ${routerID} at /${e.filepath}`);
                (router ? router : this.app).use(`/${e.filepath}`, newRouter);
            }
            dirScanned = true;
        }
        for (const route of toLoad) {
            if (!dirScanned && route.priority <= 0) {
                for (const e of scanAtPriority0) {
                    let newRouter = express.Router();
                    let newRouterID = require("randomstring").generate(5);
    
                    let childStructure = this.#loadRoutes(join(e.dir, e.filepath), newRouter, prefix, pathPrefix ? `${pathPrefix}/${e.filepath}` : `/${e.filepath}`, newRouterID, true);
    
                    structure.children.push(childStructure);
    
                    info(`Attaching router ${newRouterID} to router ${routerID} at /${e.filepath}`);
                    (router ? router : this.app).use(`/${e.filepath}`, newRouter);
                }
                dirScanned = true;
            }

            if (route.type != "use") {
                // load any local statics
                if (route.static?.length) {
                    for (const staticDir of route.static) {
                        this.#loadSingleStatic(staticDir, router ? router : this.app);
                    }
                }

                for (const method of route.validMethods) {
                    debug(`Loading method ${method} for ${route.filename}`);
                    // ignore any not functions
                    if (typeof route.methods[method] != "function") {
                        debug(`Skipping method ${method} as it is not a function`)
                        continue;
                    }

                    // set the function
                    (router ? router : this.app)[method](route.path, route.methods[method]);
                    debug(`Loaded method ${method} for ${route.filename} at ${prefix ? prefix : ""}${route.path} on router ${routerID}`);

                    structure.routeStack.push({
                        type: "route",
                        path: route.path,
                        filename: route.filename,
                        priority: route.priority,
                        methods: route.validMethods
                    })
                }
                info(`Loaded ${route.filename} at ${prefix ? prefix : ""}${pathPrefix || ""}${route.path} with priority ${route.priority} on router ${routerID}`);
            } else {
                debug(`Loading use ${route.name ? `'${route.name}' ` : ""}with priority ${route.priority} on router ${routerID}`);
                (router ? router : this.app).use(route.run);
                info(`Loaded use ${route.name ? `'${route.name}' ` : ""}with priority ${route.priority} on router ${routerID}`);

                structure.routeStack.push({
                    type: "use",
                    name: route.name,
                    priority: route.priority,
                    function: route.run
                });
            }
        }

        if (!dirScanned) {
            for (const e of scanAtPriority0) {
                let newRouter = express.Router();
                let newRouterID = require("randomstring").generate(5);

                let childStructure = this.#loadRoutes(join(e.dir, e.filepath), newRouter, prefix, pathPrefix ? `${pathPrefix}/${e.filepath}` : `/${e.filepath}`, newRouterID, true);

                structure.children.push(childStructure);

                info(`Attaching router ${newRouterID} to router ${routerID} at /${e.filepath}`);
                (router ? router : this.app).use(`/${e.filepath}`, newRouter);
            }
            dirScanned = true;
        }

        if (innerLevel) return structure;

        info(this.#viewStructure(structure));

        return this;
    }

    #loadVhosts() {
        if (!this.#vhostDirectories.length) return this;

        for (const dir of this.#vhostDirectories) {
            let files = readdirSync(dir);
            for (const filepath of files) {
                // ignore if not directory
                if (!lstatSync(join(dir, filepath)).isDirectory()) continue;
                // check name follows pattern
                if (!/\S+\.{}/g.test(filepath)) continue;
                // check for routes folder inside
                let inner = readdirSync(join(dir, filepath));
                for (const innerPath of inner) {
                    // ignore if not directory
                    if (!lstatSync(join(dir, filepath, innerPath)).isDirectory()) continue;

                    if (innerPath == "routes") {
                        let router = new express.Router();
                        info(`----- Loading routes for ${filepath.match(/(\S+)\.{}/)[1]}.${require(join(this.#settingsDir, "meta.json")).basehostname} -----`);
                        this.#loadRoutes(join(dir, filepath, "routes"), router, `${filepath.match(/(\S+)\.{}/)[1]}.${require(join(this.#settingsDir, "meta.json")).basehostname}`);

                        debug(`Loaded routes for ${filepath.match(/(\S+)\.{}/)[1]}.${require(join(this.#settingsDir, "meta.json")).basehostname}`);

                        this.app.use(vhost(`${filepath.match(/(\S+)\.{}/)[1]}.${require(join(this.#settingsDir, "meta.json")).basehostname}`, router));
                        
                        info(`----- Routes setup for ${filepath.match(/(\S+)\.{}/)[1]}.${require(join(this.#settingsDir, "meta.json")).basehostname} -----`);

                        displayRoutes(router);
                    }
                }
            }
        }
    }
    
    /**
     * Load static files from the current state.
     * @returns {ServerManager} This ServerManager.
     */
    #loadStatics(dir, router) {
        for (const search of dir?.length ? dir : dir ? [dir] : this.#staticDirectories) {
            (router ? router : this.app).use(express.static(search));
        }

        return this;
    }

    #loadSingleStatic(dir, router) {
        (router ? router : this.app).use(express.static(dir));
        return this;
    }

    /**
     * Set a settings directory.
     * @param {String} dir The directory to set.
     * @returns {ServerManager} This ServerManager.
     */
    setSettingsDir(dir) {
        this.#settingsDir = dir;
        info(`Set server settings directory to ${dir}`);
        return this;
    }

    /**
     * Add a directory to this ServerManager's list of directories to search for routes.
     * @param {String} dir The (absolute) path of the directory to add to the scanning list.
     * @returns {ServerManager} This ServerManager.
     */
    addRouteDirectory(dir) {
        if (!isAbsolute(dir)) throw new Error("Provided path was not absolute.");
        if (!this.#routeDirectories.includes(dir)) this.#routeDirectories.push(dir);
        debug(`Adding ${dir} to the list of directories to scan for routes`);
        return this;
    }

    /**
     * Add a directory to this ServerManager's list of directories to search for middleware.
     * @param {String} dir The (absolute) path of the directory to add to the scanning list.
     * @returns {ServerManager} This ServerManager.
     */
    addUseDirectory(dir) {
        if (!isAbsolute(dir)) throw new Error("Provided path was not absolute.");
        if (!this.#useDirectories.includes(dir)) this.#useDirectories.push(dir);
        debug(`Adding ${dir} to the list of directories to scan for middleware`);
        return this;
    }

    /**
     * Add a directory to this ServerManager's list of directories to search for static files.
     * @param {String} dir The (absolute) path of the directory to add to the scanning list.
     * @returns {ServerManager} This ServerManager.
     */
    addStaticDirectory(dir) {
        if (!isAbsolute(dir)) throw new Error("Provided path was not absolute.");
        if (!this.#staticDirectories.includes(dir)) this.#staticDirectories.push(dir);
        debug(`Adding ${dir} to the list of directories to scan for static files`);
        return this;
    }

    /**
     * Add a directory to this ServerManager's list of directories to search.
     * @param {String} dir The (absolute) path of the directory to add to the scanning list.
     * @returns {ServerManager} This ServerManager.
     */
    addVhostDirectory(dir) {
        if (!isAbsolute(dir)) throw new Error("Provided path was not absolute.");
        if (!this.#vhostDirectories.includes(dir)) this.#vhostDirectories.push(dir);
        debug(`Adding ${dir} to the list of directories to scan for vhost things`);
        return this;
    }

    /**
     * Set up and start the HTTPS server.
     * @returns {ServerManager} This ServerManager.
     */
    start() {
        this.#httpsServer = https.createServer({
            key: readFileSync(join(this.#settingsDir, "sslcert", "server.key"), "utf-8"),
            cert: readFileSync(join(this.#settingsDir, "sslcert", "server.crt"), "utf-8")
        }, this.app);

        this.#httpsServer.listen(this.#port);

        this.#httpsServer.on("listening", () => info(`Listening on port ${this.#port}.`));
        this.#httpsServer.on("error", e => error(e));

        return this;
    }
}

module.exports = ServerManager;

/**
 * @typedef {Object} RouteObject
 * @property {String} path
 * @property {Number=} priority
 * @property {String[]=} static
 * @property {String[]|Function[]=} use
 * @property {Number=} startingUsePriority
 * @property {Number[]=} specificUsePriorities
 * @property {RouteMethodsObject} methods
 */

/**
 * @typedef {Object} RouteMethodsObject
 * @property {RouteHandlerFunction=} checkout
 * @property {RouteHandlerFunction=} copy
 * @property {RouteHandlerFunction=} delete
 * @property {RouteHandlerFunction=} get
 * @property {RouteHandlerFunction=} head
 * @property {RouteHandlerFunction=} lock
 * @property {RouteHandlerFunction=} merge
 * @property {RouteHandlerFunction=} mkactivity
 * @property {RouteHandlerFunction=} mkcol
 * @property {RouteHandlerFunction=} move
 * @property {RouteHandlerFunction=} m-search
 * @property {RouteHandlerFunction=} notify
 * @property {RouteHandlerFunction=} options
 * @property {RouteHandlerFunction=} patch
 * @property {RouteHandlerFunction=} post
 * @property {RouteHandlerFunction=} purge
 * @property {RouteHandlerFunction=} put
 * @property {RouteHandlerFunction=} report
 * @property {RouteHandlerFunction=} search
 * @property {RouteHandlerFunction=} subscribe
 * @property {RouteHandlerFunction=} trace
 * @property {RouteHandlerFunction=} unlock
 * @property {RouteHandlerFunction=} unsubscribe
 * @property {RouteHandlerFunction=} all
 */

/**
 * @typedef {Funtion} RouteHandlerFunction
 * @param {express.Request} req
 * @param {express.Response} res
 * @param {express.NextFunction} next
 */