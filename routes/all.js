'use strict';

const { operation } = require("../managers/DatabaseManager");

/** @type {import("../managers/ServerManager").RouteObject} */
module.exports = {
    path: "*",
    priority: 0,
    startingUsePriority: 100,
    use: [
        /** @type {import("express").Handler} */
        (req, res, next) => {
            let hostname = req.hostname;

            let localname = operation(db => db.prepare("SELECT localhost FROM mappings WHERE hostname = ?").get(hostname));

            if (!localname) next();

            localname = localname.localhost;
            proxy(localname, {
                userResHeaderDecorator: (headers, userReq, userRes, proxyReq, proxyRes) => {
                    Object.keys(headers).forEach(x => {
                        if (typeof headers[x] == "string") headers[x] = headers[x].replace(localname, hostname);
                    })
                    return headers;
                }
            })(req, res, next);
        }
    ],
    methods: {
        all: (req, res) => {
            // let the request disappear off into the void (feign non-existence)
        }
    }
}