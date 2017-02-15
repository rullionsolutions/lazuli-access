"use strict";

var Access = require("lazuli-access/index.js");


module.exports = Access.MenuItem.clone({ id: "MenuItem.Level1", });


module.exports.override("getLICSSClass", function (render_children) {
    var class_list = "";
    var i;
    if (this.page) {
        class_list += " css_menu_page_" + this.page;
    }
    for (i = 0; this.modules && i < this.modules.length; i += 1) {
        class_list += " css_menu_area_" + this.modules[i];
    }
    if (render_children) {
        class_list += " dropdown";
    }
    return class_list;
});


module.exports.override("renderElement", function (session, pr_elmt_arr, render_children) {
    var bits = this.getURLandLabel(session);
    var pr_elmt;
    var li_elmt;

    if (!pr_elmt_arr[this.level + 1] && (bits.url || render_children)) {
        pr_elmt = this.parent_item.renderElement(session, pr_elmt_arr, true);
        li_elmt = pr_elmt.addChild("li", null, this.getLICSSClass(render_children));

        //  a_elmt = li_elmt.addChild("a", this.id);
        //  a_elmt.attribute("role", "button");
        // if (render_children) {
        //     a_elmt.attribute("class", "dropdown-toggle");
        //     a_elmt.attribute("data-toggle", "dropdown");
        // }
        // a_elmt.attribute("href", bits.url || "#");
        // a_elmt.addText(bits.label);
        if (render_children) {
            // li_elmt.makeDropdownButton(this.id, bits.label, "navbar-btn", null, bits.url || "#");
            li_elmt.makeDropdownIcon(this.id, bits.label, bits.url || "#");
            pr_elmt_arr[this.level + 1] = li_elmt.addChild("ul", null, "dropdown-menu");
            pr_elmt_arr[this.level + 1].attribute("aria-labelledby", this.id);
        } else {
            li_elmt.makeElement("a")
                .attr("href", bits.url || "#")
                .text(bits.label);
        }
        if (this.glyphicon) {
            pr_elmt_arr[this.level + 1].addChild("li", null, "css_menu_icon").addChild("i", null, "icon-large " + this.glyphicon);
        }
    }
    return pr_elmt_arr[this.level + 1];
});

/*
x.MenuItem.Level1.renderElement = function (session, pr_elmt_arr, render_children) {
    var bits,
        pr_elmt,
        li_elmt,
         a_elmt,
        div_elmt;//-- bc
    x.log.functionStart("renderElement", this, arguments);
    bits = this.getURLandLabel(session);
    if (!pr_elmt_arr[this.level + 1] && (bits.url || render_children)) {
        pr_elmt = this.parent_item.renderElement(session, pr_elmt_arr, true);
        li_elmt = pr_elmt.addChild("li", null, this.getLICSSClass(render_children));
         a_elmt = li_elmt.addChild("a", this.id);
         a_elmt.attribute("role", "button");
        if (render_children) {
            a_elmt.attribute("class", "dropdown-toggle");
            a_elmt.attribute("data-toggle", "dropdown");
        }
        a_elmt.attribute("href", bits.url || "#");
        if (render_children) {
            a_elmt.addChild("b", null, "caret", "&nbsp;");
            a_elmt.addText("&nbsp;");
        }
        a_elmt.addText(bits.label || "[Unknown Label]");
        pr_elmt_arr[4] = null;
        if (render_children) {
            div_elmt = li_elmt.addChild("div", null, "dropdown-menu").addChild("div", null, "css_menu_panel");
            div_elmt.attribute("aria-labelledby", this.id);
            if (this.glyphicon) {
                div_elmt.addChild("div", null, "css_menu_icon").addChild("i", null, "icon-large " + this.glyphicon);
            }
//            div_elmt = div_elmt.addChild("div", null, "row");
//            div_elmt.addChild("div", null, "col-md-6 css_menu_tasks");
            pr_elmt_arr[this.level + 1] = div_elmt.addChild("ul", null, "nav nav-list");
        }
    }
    return pr_elmt_arr[this.level + 1];
};
*/
