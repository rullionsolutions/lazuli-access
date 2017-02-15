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
            a_elmt = li_elmt.addChild("a", this.id);
            a_elmt.attribute("role", "button");
            // if (render_children) {
                // a_elmt.attribute("data-toggle", "dropdown");
            // }
            a_elmt.attribute("href", bits.url || "#");
            a_elmt.addText(bits.label);
            // pr_elmt_arr[this.level + 1] = li_elmt.addChild("ul", null, "dropdown-menu");
            // pr_elmt_arr[this.level + 1].attribute("aria-labelledby", this.id);
        }
        if (render_children) {
            pr_elmt_arr[this.level + 1] = pr_elmt;
        }
    }
    return pr_elmt_arr[this.level + 1];
});


/*
x.MenuItem.Level2.renderElement = function (session, pr_elmt_arr, render_children) {
    var bits,
        pr_elmt,
        li_elmt,
         a_elmt;//-- bc
    x.log.functionStart("renderElement", this, arguments);
    bits = this.getURLandLabel(session);
    if (bits.url) {
        pr_elmt = this.parent_item.renderElement(session, pr_elmt_arr, true);
        li_elmt = pr_elmt.addChild("li");
        a_elmt = li_elmt.addChild("a");
//        a_elmt.attribute("tabindex", "-1");
        a_elmt.attribute("href", bits.url);
        a_elmt.addText(bits.label);
    } else if (bits.label && render_children && !pr_elmt_arr[this.level + 1]) {
        pr_elmt = this.parent_item.renderElement(session, pr_elmt_arr, true);
        li_elmt = pr_elmt.addChild("li");
        li_elmt.attribute("class", "nav-header");
        li_elmt.addText(bits.label);
        pr_elmt_arr[this.level + 1] = pr_elmt;
    }
    return pr_elmt_arr[this.level + 1];
};
*/
