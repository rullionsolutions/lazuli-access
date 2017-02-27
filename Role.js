"use strict";

var Core = require("lapis-core/index.js");

// var roles = {};

/**
* To represent a functional area of the system
*/

module.exports = Core.Base.clone({
    id: "Role",
    title: null,                     // name of this role
    params: null,                     // role-specific parameter object
    priority: 0,
});
