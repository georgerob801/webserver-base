'use strict';

/**
 * A class that handles interaction with a database.
 */
class DatabaseManager {
    /**
     * True/false depending on whether the DatabaseManager is ready to be used.
     * @type {Boolean}
     * @static
     * @private
     */
    static #ready = false;

    /**
     * The path of the database.
     * @type {String}
     * @static
     * @private
     */
    static #path;

    /**
     * All table definitions.
     * @type {String[]}
     * @static
     * @private
     */
    static #tableDefinitions = [
		
    ]

    /**
     * Initialise the DatabaseManager.
     * @param {String} dbPath The path to the database.
     * @returns {DatabaseManager} A reference to the DatabaseManager class.
     */
    static init(dbPath) {
        // check for db path
        if (!dbPath) throw new Error("no database path provided");
        DatabaseManager.#path = dbPath;

        // set ready
        DatabaseManager.#ready = true;
        // create tables if required
        DatabaseManager.operation(db => {
            DatabaseManager.#tableDefinitions.forEach(x => {
                db.exec(`CREATE TABLE IF NOT EXISTS ${x}`);
            })
        });

        return DatabaseManager;
    }

    /**
     * Run a function on the 
     * @param {Function} f The function to run on the database.
     * @returns {any} The result of the function.
     */
    static operation(f) {
        // ensure handler is set up
        if (!DatabaseManager.#ready) throw new Error("the database handler has not been initialised");
        // load db
        let db = require("better-sqlite3")(DatabaseManager.#path);
        let output;
        // attempt function
        try {
            output = f(db);
        } catch (e) {
            db.close();
            throw e;
        }
        db.close();
        return output;
    }
}

module.exports = DatabaseManager;