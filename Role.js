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


module.exports.roles = Core.Collection.clone({
    id: "roles",
    item_type: module.exports,
});


// module.exports.defbind("registerRole", "cloneType", function () {
//     if (roles[this.id]) {
//         this.throwError("role already registered: " + this.id);
//     }
//     roles[this.id] = this;
// });


module.exports.define("getRole", function (id) {
    if (!module.exports.roles[id]) {
        this.throwError("role not registered: " + id);
    }
    return module.exports.roles[id];
});
