"use strict";

var Core = require("lapis-core/index.js");


module.exports = Core.MessageManager.clone({
    id: "MessageManagerSession",
});


module.exports.define("getTrans", function () {
//    return this.session.page_cache[0] && this.session.page_cache[0].trans;
    return this.trans;          // TODO better way to link session to trans...
});


module.exports.override("chain", function (funct) {
//    var trans = (this.session.page_cache[0] && this.session.page_cache[0].trans);
    var trans = this.getTrans();
    if (trans) {
        this.trace("chain to trans level: " + trans);
        funct(trans.messages);
    }
});


module.exports.override("clear", function (tag) {
    Core.MessageManager.clear.call(this, tag);
    this.chain(function (msg_mgr) {
        msg_mgr.clear(tag);
    });
});
