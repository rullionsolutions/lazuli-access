"use strict";

var Access = require("lazuli-access/index.js");


module.exports = Access.MenuItem.clone({ id: "MenuItem.Level1", });


module.exports.override("getLICSSClass", function (render_children) {
    var class_list = "css_menu_dyn";
    var i;
    if (this.page) {
        class_list += " css_menu_page_" + this.page;
    }
    for (i = 0; this.modules && i < this.modules.length; i += 1) {
        class_list += " css_menu_area_" + this.modules[i];
    }
    if (render_children) {
        class_list += " has-sub";
    }
    return class_list;
});


module.exports.override("renderElement", function (session, pr_elmt_arr, render_children) {
    var bits = this.getURLandLabel(session);
    var pr_elmt;
    var li_elmt;
    var anchor_elmt;

    if (!pr_elmt_arr[this.level + 1] && (bits.url || render_children)) {
        pr_elmt = this.parent_item.renderElement(session, pr_elmt_arr, true);
        li_elmt = pr_elmt.makeElement("li", this.getLICSSClass(render_children));

        anchor_elmt = li_elmt.makeElement("a")
            .attr("href", bits.url || "javascript:;");

        if (this.fa_icon) {
            anchor_elmt.makeElement("i", "fa " + this.fa_icon);
        }
        if (render_children) {
            anchor_elmt.makeElement("b", "caret pull-right");
        }
        anchor_elmt.makeElement("span").text(bits.label);

        if (render_children) {
            pr_elmt_arr[this.level + 1] = li_elmt.makeElement("ul", "sub-menu");
            pr_elmt_arr[this.level + 1].attr("aria-labelledby", this.id);
        }
    }
    return pr_elmt_arr[this.level + 1];
});
