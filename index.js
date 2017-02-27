"use strict";

var Core = require("lapis-core/index.js");


exports.Role = require("lazuli-access/Role.js");

exports.roles = Core.Collection.clone({
    id: "roles",
    item_type: exports.Role,
});


exports.Session = require("lazuli-access/Session.js");
require("lazuli-access/Session-SQL.js");
exports.MenuItem = require("lazuli-access/MenuItem.js");
exports.MenuItem = require("lazuli-access/MenuItem.js");
exports.MenuItem.Level1 = require("lazuli-access/MenuItem.Level1.js");
exports.MenuItem.Level2 = require("lazuli-access/MenuItem.Level2.js");
exports.MenuItem.Level3 = require("lazuli-access/MenuItem.Level3.js");
exports.MessageManagerSession = require("lazuli-access/MessageManagerSession.js");
