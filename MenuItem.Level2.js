"use strict";

var Access = require("lazuli-access/index.js");


module.exports = Access.MenuItem.clone({ id: "MenuItem.Level2", });


module.exports.override("getLICSSClass", function (render_children) {
    var class_list = "";
    if (render_children) {
        // class_list += " dropdown-submenu";
        class_list += " dropdown-header";
    }
    return class_list;
});


module.exports.override("renderElement", function (session, pr_elmt_arr, render_children) {
    var pr_elmt;
    var li_elmt;
    var a_elmt;
    var bits = this.getURLandLabel(session);
    if (!pr_elmt_arr[this.level + 1] && (bits.url || render_children)) {
        pr_elmt = this.parent_item.renderElement(session, pr_elmt_arr, true);
        if (render_children) {
            pr_elmt.makeElement("li", "divider")
                .attr("role", "separator");
        }
        if (render_children && !bits.url) {
            pr_elmt.makeElement("li", "dropdown-header").text(bits.label);
        } else {
            li_elmt = pr_elmt.makeElement("li");
            a_elmt = li_elmt.makeElement("a", null, this.id);
            a_elmt.attr("role", "button");
            a_elmt.attr("href", bits.url || "#");
            a_elmt.text(bits.label);
        }
        if (render_children) {
            pr_elmt_arr[this.level + 1] = pr_elmt;
        }
    }
    return pr_elmt_arr[this.level + 1];
});
