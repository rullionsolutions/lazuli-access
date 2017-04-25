"use strict";

var Core = require("lapis-core/index.js");
var UI = require("lazuli-ui/index.js");
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
module.exports.register("beforeGetPage");
module.exports.register("afterGetPage");
module.exports.register("render");
module.exports.register("close");


module.exports.define("getNewSession", function (spec) {
    if (this.instance) {
        this.throwError("must be called on a type");
    }
    spec.id = Core.Format.getRandomNumber(10000000000);
    spec.instance = true;
    return this.clone(spec);
});


module.exports.defbind("setupSession", "cloneInstance", function () {
    if (!this.user_id) {
        this.throwError("user_id property required");
    }
    this.active = true;
    this.visits = 0;
    this.messages = this.getMessageManager();
    this.page_cache = [];
    this.active_trans_cache = {};
    this.roles = [];
    this.list_section = {};
    session_cache[this.id] = this;
    this.happen("start");           // NOTE: could probably just use cloneInstance for this
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
    var spec = {
        page_id: page_id,
        page_key: page_key,
    };
    this.happen("beforeGetPage", spec);
    spec.page = this.getPageFromCacheAndRemove(spec.page_id, spec.page_key);
    if (!spec.page) {
        spec.page = this.getNewPage(page_id, page_key);
    }
    this.clearPageCache();
    this.page_cache.unshift(spec.page);                // add page to beginning of array
    this.recordAtInterval();
    if (spec.page.isMainNavigation()) {
        this.last_non_trans_page_url = spec.page.getSimpleURL();
    }
    this.happen("afterGetPage", spec);
    return spec.page;
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
*   if it contains '#page_id=' then allowed() is called on the page specified, otherwise access
*   is presumed
* @param url: relative or absolute
* @return true if access is not prevented, and false otherwise
*/
module.exports.define("allowedURL", function (url) {
    var page;
    var match = url.match(/[#&]page_id=(\w+)(&page_key=([\w.]+))?/);
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


module.exports.define("allowedPageTask", function (page_id, page_key, allowed) {
    return false;
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
    this.happen("render", {
        parent_elmt: elmt,
        render_opts: render_opts,
    });
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
