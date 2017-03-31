"use strict";

var Core = require("lapis-core/index.js");
var UI = require("lazuli-ui/index.js");
var SQL = require("lazuli-sql/index.js");
var Data = require("lazuli-data/index.js");
var Access = require("lazuli-access/index.js");

var session_cache = {};

/**
* To represent a user interacting with the system
*/
module.exports = Core.Base.clone({
    id: "Session",
    active: false,
    home_page_id: "home",
    max_inactive_interval: (60 * 30),            // in seconds, 30 mins
//    allow_multiple_concurrent: false
//          -- not implemented until we have cross-app-server comms
});


module.exports.register("start");
module.exports.register("close");


module.exports.override("clone", function (spec) {
    var session;
    if (!spec.user_id) {
        this.throwError("user_id property required");
    }
    spec.instance = true;
    this.prepareSpec(spec);
    session = Core.Base.clone.call(this, spec);
    session.active = true;
    session.visits = 0;
    session.messages = session.getMessageManager();
    session.page_cache = [];
    session.active_trans_cache = {};
    session.roles = [];
    session.list_section = {};
    session_cache[spec.id] = session;
    session.happen("start");
    return session;
});


// shim
module.exports.define("events", {
    add: function (id, event, script) {
        module.exports.warn("Session.events shim used: " + id + ", " + event);
        module.exports.defbind(id, event, script);
    },
});


module.exports.define("getMessageManager", function () {
    if (!this.messages) {
        this.messages = Access.MessageManagerSession.clone({
            id: this.id,
            session: this,
            instance: true,
        });
    }
    return this.messages;
});


module.exports.define("prepareSpec", function (spec) {
    if (!spec.id) {
        spec.id = Core.Format.getRandomNumber(10000000000);
    }
});


module.exports.define("getSessionId", function () {
    return this.id;
});


module.exports.define("addRole", function (role_id) {
    this.roles.push(Access.roles.get(role_id));      // throws Error if role_id not registered
});


module.exports.define("addRoleProperties", function () {
    var i;
    this.roles.sort(function (a, b) {                    // sort roles by priority, lowest first
        return a.priority - b.priority;
    });
    for (i = 0; i < this.roles.length; i += 1) {
        if (this.roles[i].params) {
            this.addProperties(this.roles[i].params);
        }
    }
});


module.exports.define("isUserInRole", function (role_id) {
    return (this.roles.filter(function (role) { return role.id === role_id; }).length > 0);
});


module.exports.define("isAdmin", function (module_id) {
    var area = module_id && Data.areas.get(module_id);
    var allowed = {
        access: this.isUserInRole("sysmgr"),
    };

    if (area && area.security) {
        this.checkSecurityLevel(area.security, allowed, "area");
    }
    return allowed.access;
});


/**
* To make a new Transaction linked to this Session, link this MessageManager
*   to its MessageManager, and return it
* @return new Transaction object
*/
module.exports.define("getNewTrans", function (props) {
    var trans;
    props = props || {};
    props.session = this;
    trans = Data.Transaction.clone(props);
    // this.curr_active_trans = trans;
    return trans;
});


/**
* To get an x.Page object given the page id and page key passed in, which may be retrieved
*   from cache if called before, or else created new
* @param page_id: string; page_key: string, mandatory if the page requires_key property is true
* @return The page object
*/
module.exports.define("getPage", function (page_id, page_key) {
    var page;
    if (this.force_password_change && page_id !== "ac_pswd_change") {
        this.messages.add({
            type: "W",
            text: "Please change your password before doing anything else",
        });
        page_id = "ac_pswd_change";
        page_key = null;
    }
    page = this.getPageFromCacheAndRemove(page_id, page_key);
    if (!page) {
        page = this.getNewPage(page_id, page_key);
    }
    this.clearPageCache();
    this.page_cache.unshift(page);                // add page to beginning of array
    this.recordAtInterval();
    if (!page.transactional && page.main_navigation !== false) {
        this.last_non_trans_page_url = page.getSimpleURL();
    }
    return page;
});


module.exports.define("recordAtInterval", function () {
    return undefined;
});


module.exports.define("getPageFromCacheAndRemove", function (page_id, page_key) {
    var page;
    var i;

    for (i = 0; i < this.page_cache.length; i += 1) {
        this.trace("getPageFromCacheAndRemove() " + page_id + ", " + page_key + ", " +
            typeof page_key + ", " + this.page_cache[i].page_key + ", " +
            typeof this.page_cache[i].page_key);
        if (this.page_cache[i].id === page_id && this.page_cache[i].page_key === page_key) {
            page = this.page_cache[i];
            this.page_cache.splice(i, 1);            // remove page from page_cache
            break;
        }
    }
    // i = 0;
    // cancel other transactional pages and clear from cache
    // while (i < this.page_cache.length) {
    //     if (this.page_cache[i].transactional ) {
    //         if (this.page_cache[i].active) {
    //             this.page_cache[i].cancel();
    //         }
    //         this.page_cache.splice(i, 1);            // remove page from page_cache
    //     } else {
    //         i += 1;
    //     }
    // }
    // if (page && page.active && page_key && page_key !== page.page_key) {
    //     page.cancel();        // makes page inactive
    // }
    if (page && !page.active) {
        page = null;
    }
    return page;
});


module.exports.define("getNewPageNoTidyUp", function (page_id, page_key) {
    var page_obj = UI.pages.get(page_id);
    var page_inst;
    var allowed;

    if (!page_obj) {
        this.throwError("page not found: " + page_id);
    }
    allowed = page_obj.allowed(this, page_key);
    if (!allowed.access) {
        allowed.id = "access_denied";
        if (allowed.reason === "workflow-only page") {
            this.checkCompletedWorkflowTask(page_id, page_key, allowed);
        }
        this.debug(allowed.toString());          // provide fuller reason text
        this.throwError(allowed);
    }
    page_inst = page_obj.clone({
        id: page_id,
        page: page_id,
        page_key: page_key,
        session: this,
        instance: true,
        allowed: allowed,
    });
    page_inst.setup();                        // without page being cancelled and reloaded
    return page_inst;
});


module.exports.define("getNewPage", function (page_id, page_key) {
    var page;
    var allowed;

    if (!UI.pages.get(page_id)) {
        this.throwError("page not found: " + page_id);
    }
    allowed = UI.pages.get(page_id).allowed(this, page_key);
    if (!allowed.access) {
        allowed.id = "access_denied";
        if (allowed.reason === "workflow-only page") {
            this.checkCompletedWorkflowTask(page_id, page_key, allowed);
        }
        this.debug(allowed.toString());          // provide fuller reason text
        this.throwError(allowed);
    }
    try {
        page = UI.pages.get(page_id).clone({
            id: page_id,
            page: page_id,
            page_key: page_key,
            session: this,
            instance: true,
            allowed: allowed,
        });
//        page.page_key = page_key;
// Can be used in setup() since cannot subsequently change
//        this.checkWorkflowPage(page);
        page.setup();                        // without page being cancelled and reloaded
    } catch (e) {
        if (page) {
            page.cancel();          // added code to cancel page, transaction, etc
        }
        this.report(e);
        // if (this.connection) {
        //     this.connection.executeUpdate("ROLLBACK");
        // }
        // if (!exc.text) {
        //     exc.text = "Page Setup Error: " + exc.id + " in " +
        //      Page.getPage(page_id).title + (page_key ? " [" + page_key + "]" : "");
        // }
        this.messages.report(e);
        throw e;
    }
    return page;
});


/**
* To efficiently obtain and process the active workflow tasks for a specific
*   page_id/page_key combination
* @param page_id, page_key, callback function called for each task, having arguments:
*   assigned_user, user_name, attributes array
*   due_date, one_time_lock_code, wf_inst_id, wf_inst_node_id, wf_inst_node_title;
*   if the function returns false, the loop is exited
*/
module.exports.define("getPageTasks", function (page_id, key, callback) {
    return undefined;
});


/**
* To get the attributes of the first active task found for the given page_id/page_key combination
* @param page_id, page_key
* @return object containing the task's information, if found, or undefined
*/
module.exports.define("getPageTaskInfo", function (page_id, page_key) {
    var out;
    this.getPageTasks(page_id, page_key, function (assigned_user, user_name, attributes,
            due_date, one_time_lock_code, inst_id, node_id, node_title) {
        if (assigned_user) {
            out = {
                assigned_user_id: assigned_user,
                assigned_user_name: Core.Format.convertNameFirstSpaceLast(user_name),
                attributes: attributes,
                due_date: Date.parse(due_date).display(),
                one_time_lock_code: one_time_lock_code,
                wf_inst_id: inst_id,
                wf_inst_node_id: node_id,
                wf_inst_node_title: node_title,
            };
            // break after 1st hit with an assigned user (would there ever be any others?)
            return false;
        }
        return true;
    });
    return out;
});


/*
* To see whether there is a workflow task for the page_id / key combination that is performable
*       by this user, according to the following logic:
* 1. if an active workflow task for this page_id / key is assigned to this user, return true;
* 2. otherwise if an active workflow task for this page_id / key has a one time execution lock
*       code that matches the one for this session
* 3. otherwise if an active workflow task for this page_id / key exists and the access_to_page
*       argument is true, return true;
* 4. otherwise if an active workflow task for this page_id / key has its 'automatic' attribute
*       set, return true;
* 5. otherwise if an active workflow task for this page_id / key is assigned to a user who has
*       delegated to this user, return true;
* 6. if no matching active workflow tasks for this page_id / key combination satisfy the above,
*       return false
* @params page id (string); page key (string) mandatory if page requires a key; access_to_page
*       (boolean) optional, true to apply any active matching workflow task to this user
* @return true if at least one active matching workflow task is relevant for this user, false
*       otherwise
*/
module.exports.define("allowedPageTask", function (page_id, page_key, allowed) {
    var that = this;
    this.getPageTasks(page_id, page_key, function (assigned_user, user_name, attributes,
            due_date, one_time_lock_code, inst_id, node_id, node_title) {
        var text;
        var reason;

        if (assigned_user === that.user_id) {
            reason = "user is task assignee";
            text = "You are performing your assigned task: ";
        }
        if (one_time_lock_code === that.one_time_lock_code && (attributes.indexOf("OT") > -1)) {
            reason = "one-time lock code supplied";
            text = "You are performing this task as a guest: ";
            allowed.one_time_guest_wf_access = true;
        }
        if (allowed.access) {
            reason = "active task exists, user has basic access";
            text = "You are performing general task: ";
        }
        if (attributes.indexOf("AU") > -1) {
            reason = "task is automatic";
        }
        if (that.delegaters && that.delegaters[assigned_user] && (attributes.indexOf("PD") === -1)) {
            reason = "user is delegatee of task assignee";
            text = "You are performing your delegated task: ";
        }
        if (reason) {
            allowed.reason = (allowed.reason ? allowed.reason + ", " : "") + reason;
            allowed.task_found = true;
            if (!allowed.wf_tasks) {
                allowed.wf_tasks = [];
            }
            allowed.wf_tasks.push([
                inst_id,
                node_id,
                (text && (attributes.indexOf("ST") > -1) ? text + node_title : null),
            ]);
        }

        this.debug("allowedPageTask(): " + reason + ", " + text + ", " + attributes);
        return true;            // process all matching tasks
//        return !allowed.task_found;
        // if task_found then no further processing is required
    });
    return allowed.task_found;
});


module.exports.define("checkCompletedWorkflowTask", function (page_id, page_key, allowed) {
    return undefined;
});


/**
* Get a page object from cache, according to the given page_id passed in, if it exists in the cache
* @param page id: string
* @return page object if present in cache, else null
*/
module.exports.define("getPageFromCache", function (page_id) {
    var i;
    for (i = 0; i < this.page_cache.length; i += 1) {
        if (this.page_cache[i].id === page_id) {
            return this.page_cache[i];
        }
    }
    return null;
});


/**
* To clear the page cache, optional leaving some pages; calls cancel() on each page object removed
* @params number_to_leave: number, optional
*/
module.exports.define("clearPageCache", function (clear_all) {
    var page;
    var i = 0;

    while (i < this.page_cache.length) {
        page = this.page_cache[i];
        if (!clear_all && page.keepAfterNavAway()) {
            i += 1;
        } else {
            this.page_cache.splice(i, 1);
            if (page.active) {
                page.cancel();                    // remove last item from array and cancel it
            }
        }
    }
});


/**
* To remove a given page object from cache, if present; calls cancel() on the page object removed
* @param page id: string
*/
module.exports.define("clearPageFromCache", function (page_id) {
    var i = 0;
    while (i < this.page_cache.length) {
        if (this.page_cache[i].id === page_id) {
            this.page_cache[i].cancel();
            this.page_cache.splice(i, 1);
        } else {
            i += 1;
        }
    }
});


/**
* To close this session object, reporting any remaining messages, closing any open pages
*   (and their transactions)
*/
module.exports.define("close", function () {
    if (!this.active) {
        return;
    }
    this.happen("close");
    this.newVisit(null, "Final Messages");
    this.updateVisit();            // report leftover messages
    this.clearPageCache(true);
    this.cancelActiveTransactions();
    this.persistSessionEnd();
    if (this.http_session) {
        try {
            this.http_session.removeAttribute("js_session");
            this.http_session.invalidate();
        } catch (ignore) {
            this.trace(ignore);
        }            // swallow 'already invalidated'
        delete this.http_session;
    }
    this.active = false;
    delete session_cache[this.id];
});


module.exports.define("addActiveTransaction", function (trans) {
    this.active_trans_cache[trans.id] = trans;
});


module.exports.define("removeActiveTransaction", function (trans_id) {
    delete this.active_trans_cache[trans_id];
});


module.exports.define("cancelActiveTransactions", function () {
    var that = this;
    Object.keys(this.active_trans_cache).forEach(function (trans_id) {
        that.active_trans_cache[trans_id].cancel();     // calls removeActiveTransaction()
    });
});


module.exports.define("persistSessionEnd", function () {
    return undefined;
});


/**
* To close all session objects (optionally either (a) except this session object or
*   (b) only sessions for the given user id)
* @param except_this_session_id (string) optional - don't close the specified session;
*   only_this_user_id (string) optional - only close this user's sessions
* @return number of sessions closed
*/
module.exports.define("closeAll", function (except_this_session_id, only_this_user_id) {
    var count = 0;
    Object.keys(session_cache).forEach(function (session_id) {
        var session = session_cache[session_id];
        if (session_id !== except_this_session_id
                && (!only_this_user_id || only_this_user_id === session.user_id)) {
            session.close();
            count += 1;
        }
    });
    return count;
});


// always_check_key forces a check of record's existence
/**
* To determine whether or not this user has permission to access the page given by the URL -
*   if it contains '?page_id=' then allowed() is called on the page specified, otherwise access
*   is presumed
* @param url: relative or absolute
* @return true if access is not prevented, and false otherwise
*/
module.exports.define("allowedURL", function (url) {
    var page;
    var match = url.match(/[?&]page_id=(\w+)(&page_key=([\w.]+))?/);
    this.trace("allowedURL() url: " + url + ", match: " + match);
    if (!match) {
        return true;
    }
    page = UI.pages.get(match[1]);
    if (!page) {
        this.throwError("page not found: " + match[1]);
    }
    return page.allowed(this, (match.length > 3 ? match[3] : null)).access;
});


/**
* To check a specific security rule
* @params security rule object, allowed object, level string
*/
module.exports.define("checkSecurityLevel", function (obj, allowed, level) {
    var that = this;
    Object.keys(obj).forEach(function (n) {
        if (that.isUserInRole(n) && typeof obj[n] === "boolean") {
            allowed.found = true;
            allowed.access = allowed.access || obj[n];
            allowed.role = (allowed.role ? allowed.role + ", " : "") + n;
        }
    });
    if (!allowed.found && typeof obj.all === "boolean") {
        allowed.found = true;
        allowed.access = obj.all;
        allowed.role = "all";
    }
    if (allowed.found) {
        allowed.reason = "basic security at level: " + level + " for role(s) " + allowed.role;
    }
});


module.exports.define("renderTaskRecord", function (resultset, iter) {
    var css_class = "css_task";
    var elmt_task;
    var page_id = SQL.Connection.getColumnString(resultset, 1);
    var page_key = SQL.Connection.getColumnString(resultset, 2);
    var step_title = SQL.Connection.getColumnString(resultset, 3);
    var inst_title = SQL.Connection.getColumnString(resultset, 4);
    var due_date = SQL.Connection.getColumnString(resultset, 5);
    var module = SQL.Connection.getColumnString(resultset, 6);
    var page = UI.pages.getThrowIfUnrecognized(page_id);

    if (iter.module !== module) {
        this.renderTaskModule(iter, module);
    }
    if (iter.page_id !== page_id) {
        this.renderTaskGroup(iter, page_id, step_title);
    }
    if (due_date && due_date < iter.today) {
        css_class += "_overdue";
    }
    elmt_task = iter.elmt_task_group.addChild("li", null, css_class).addChild("a");
    elmt_task.attribute("href", page.getSimpleURL(page_key));
    elmt_task.addText(inst_title);
});


module.exports.define("renderTaskModule", function (iter, module) {
    iter.elmt_module = iter.elmt_top.addChild("div", module, "css_menu_tasks");
    iter.module = module;
});


module.exports.define("renderTaskGroup", function (iter, page_id, step_title) {
    // var li_elmt,
    //      a_elmt;
//    iter.elmt_task_group = iter.elmt_module.addChild("ul", null, "nav nav-list");
//    iter.elmt_task_group.addChild("li", null, "nav-header", step_title);

    // li_elmt = iter.elmt_module.addChild("li", null, "dropdown-submenu");
    //  a_elmt = li_elmt.addChild("a", page_id);
    //  a_elmt.attribute("data-toggle", "dropdown");
    //  a_elmt.attribute("href", "#");
    //  a_elmt.addChild("i", null, "glyphicon glyphicon-ok");
    //  a_elmt.addText(step_title);
    // iter.elmt_task_group = li_elmt.addChild("ul", null, "dropdown-menu");
    // iter.elmt_task_group.attribute("aria-labelledby", page_id);

    iter.elmt_task_group = iter.elmt_module;            // no sub-level
    iter.elmt_task_group.makeElement("li", "divider").attr("role", "separator");
    iter.elmt_task_group.makeElement("li", "dropdown-header").text(step_title);
    iter.page_id = page_id;
});


/**
* To render this session's information
* @param XmlStream object to render the HTML to
*/
module.exports.define("render", function (elmt, render_opts) {
    var elmtFooter = elmt.makeElement("div", "css_hide", "css_payload_session_data");
    elmtFooter.attr("data-session-id", this.id);
    elmtFooter.attr("data-chameleon", this.chameleon || "");
    elmtFooter.attr("data-is-guest", String(!!this.is_guest));
    elmtFooter.attr("data-home-page-url", this.home_page_url || "");
    elmtFooter.attr("data-help-article", this.help_article || "");
    elmtFooter.attr("data-server-purpose", this.server_purpose || "");
    elmtFooter.attr("data-max-inactive-interval", String(this.max_inactive_interval) || "");

    elmtFooter.makeElement("div", null, "css_payload_user_data")
        .attr("data-user-id", this.user_id)
        .attr("data-user-name", this.user_name)
        .text(this.nice_name);

    this.roles.forEach(function (role) {
        elmtFooter.makeElement("div", null, "css_payload_user_role_data")
            .attr("data-role-id", role.id)
            .text(role.title);
    });

    this.messages.render(elmt.makeElement("div", "css_hide", "css_payload_messages"), "report");
    this.messages.clear("report");
    this.renderTasks(elmt.makeElement("div", "css_hide", "css_payload_tasks"));
});


// to be overridden in wf
module.exports.define("renderTasks", function (elmt) {
    return undefined;
});


module.exports.define("unisrch", function (query, out, limit) {
    var i;
    var count = 0;

    for (i = 0; i < this.unisrch_entities.length; i += 1) {
        try {
            if (limit > count) {
                count += this.unisrch_entities[i].unisrch(this, query, out, count, limit);
            }
        } catch (e) {
            this.report(e);
        }
    }
    return count;
});


/**
* To respond to a unisrch query by looping through entities with their full_text_search
*   property set true, calling unisrch() on each
* @param query: string entered in the search box; out: object to which results are added;
*   limit: number of matches required
* @return number of matches found
*/
module.exports.defbind("unisrchOrder", "start", function () {
    var that = this;
    this.unisrch_entities = [];
    Data.entities.each(function (entity) {
        if (entity.full_text_search) {
            that.unisrch_entities.push(entity);
        }
    });
    this.unisrch_entities.sort(function (a, b) {            // sort roles by priority, lowest first
        return (typeof a.full_text_sequence === "number" ? a.full_text_sequence : 0)
             - (typeof b.full_text_sequence === "number" ? b.full_text_sequence : 0);
    });
});


module.exports.defbind("setupHomePageURL", "start", function () {
    if (this.home_page_id && !this.home_page_url) {
        try {
            this.home_page_url = UI.pages.getThrowIfUnrecognized(this.home_page_id).getSimpleURL();
        } catch (e) {
            this.report(e);
        }
    }
    this.last_non_trans_page_url = this.home_page_url;
});

/*
* To output session properties as a JSON object
* @param include_messages (boolean) whether or not to include unreported messages
* @return JSON object resulting
*/
module.exports.define("getJSON", function (include_messages) {
    var out = {};
    out.id = this.id;
    out.user_name = this.user_name;
    out.nice_name = this.nice_name;
    out.user_id = this.user_id;
    out.chameleon = this.chameleon;
    out.is_guest = !!this.is_guest;
    out.visits = this.visits;
    out.home_page_url = this.home_page_url;
    out.help_article = this.help_article;
    out.server_purpose = this.server_purpose;
    out.ping_mechanism = this.ping_mechanism;
    out.roles = {};
    this.roles.forEach(function (role) {
        out.roles[role.id] = role.title;
    });
    if (include_messages) {
        out.messages = [];
        this.messages.addJSON(out.messages, "report");
        this.messages.clear("report");
    }
    return out;
});


module.exports.define("pageCurrentlyInUpdate", function () {
    var i;
    for (i = 0; i < this.page_cache.length; i += 1) {
        if (this.page_cache[i].internal_state < 39) {
            return true;
        }
    }
    return false;
});


module.exports.define("logoutDueToInactivity", function () {
    return (((new Date()).getTime() - this.datetime_of_last_post) >
        (this.max_inactive_interval * 1000)
        && !this.pageCurrentlyInUpdate());
});


/**
* To indicate whether or not an error was ever recorded in this session
* @return 1 if this session's error_recorded property is true (set by a call to msg()
*   with type: 'E'), or 0 otherwise
*/
module.exports.define("getFinalStatus", function () {
    return (this.messages.error_recorded ? "1" : "0");
});


module.exports.define("newVisit", function (page_id, page_title, params, page_key) {
    this.visits += 1;
    return this.visits;
});


module.exports.define("updateVisit", function (trans, start_time) {
    this.messages.trans = trans;
    // this.messages.clear("record");
});
