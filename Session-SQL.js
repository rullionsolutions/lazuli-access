"use strict";

var Core = require("lapis-core/index.js");
var Data = require("lazuli-data/index.js");
var SQL = require("lazuli-sql/index.js");
var Access = require("lazuli-access/index.js");
var Rhino = require("lazuli-rhino/index.js");


Access.Session.reassign("prepareSpec", function (spec) {
    spec.session_row = Data.entities.get("ac_session").cloneAutoIncrement({}, {
        user_id: spec.user_id,
        start_dttm: "now",
        status: "A",
        runtime: (Rhino.app.runtime_row && Rhino.app.runtime_row.getKey()) || "",
        lb_server: spec.rsl_lb_server || "",
        server_ident: Rhino.app.server_ident + " via " + spec.rsl_lb_server,
        chameleon: spec.chameleon || "",
        user_agent: spec.user_agent || "unknown",
    });
    spec.id = spec.session_row.getKey();
    this.info("new session id: " + spec.id);
});


Access.Session.defbind("getUserData", "start", function () {
    this.user_row = Data.entities.get("ac_user").getRow(this.user_id);        // unmodifiable row
    this.user_name = this.user_row.getField("name").get();
    this.nice_name = Core.Format.convertNameFirstSpaceLast(this.user_name);
});


Access.Session.defbind("loadRoles", "start", function () {
    var query = Data.entities.get("ac_user_role").getQuery(true);          // default sort
    query.addCondition({
        column: "user_id",
        operator: "=",
        value: this.user_id,
    });
    while (query.next()) {
        this.addRole(query.getColumn("A.role_id").get());
    }
    query.reset();
    this.addRoleProperties();
});


Access.Session.defbind("loadDelegaters", "start", function () {
    var query = Data.entities.get("ac_user_deleg").getQuery();
    var delegater;
    var delegaters_text = "";
    var delim = "";

    this.delegaters = {};
    this.delegaters_sql_condition = "";
    query.addTable({
        table: "ac_user",
        join_cond: "?._key = A.delegater",
    }).addColumn({ name: "name", });
    query.addCondition({
        column: "delegatee",
        operator: "=",
        value: this.user_id,
    });
    while (query.next()) {
        delegater = query.getColumn("A.delegater").get();
        this.delegaters[delegater] = true;
        this.delegaters_sql_condition += delim + SQL.Connection.escape(delegater);
        delegaters_text += delim + Core.Format.convertNameFirstSpaceLast(query.getColumn("B.name").get());
        delim = ", ";
    }
    query.reset();
    if (delegaters_text) {
        this.getMessageManager().add({
            type: "I",
            text: "You are the workflow delegate for: " + delegaters_text,
        });
    }
});


/**
* Checks whether it is necessary to change the password according the password_change_period
* property or if pswd_last_upd is blank in the db.
*/
Access.Session.defbind("passwordLastUpdated", "start", function () {
    var last_upd;
    var days_left;

    if (this.is_guest || this.chameleon) {
        return;
    }
    last_upd = this.user_row.getField("pswd_last_upd").getDate();
    if (typeof this.password_change_period === "number") {
        if (!last_upd) {
            this.force_password_change = true;
            return;
        }
        last_upd.add("M", this.password_change_period);
        days_left = (new Date()).daysBetween(last_upd);
        this.debug("Session.passwordLastUpdated() " + last_upd + ", " + days_left);
        if (days_left < 0) {
            this.force_password_change = true;
        } else if (days_left < this.password_reminder_period) {
            this.getMessageManager().add({
                type: "W",
                text: "Please change your password within the next " + days_left + " days",
            });
        }
    }
});


Access.Session.reassign("persistSessionEnd", function () {
    try {
        this.session_row.getField("status").set("C");
        this.session_row.getField("end_dttm").set("NOW");
        // this.session_row.getField("user_agent").set(this.user_agent);
        this.session_row.save();
    } catch (e) {
        this.report(e);
    }
});


/**
* To log in the session.messages the last login date and time taken from the db using the user_id
* as key for the query
*/
Access.Session.defbind("reportLastLogin", "start", function () {
    var resultset;
    var last_login_dttm;
    if (this.is_guest) {
        return;
    }
    try {
        resultset = SQL.Connection.shared.executeQuery("SELECT MAX(start_dttm) FROM ac_session WHERE user_id="
            + SQL.Connection.escape(this.user_id) + " AND id <> " + this.id);
        resultset.next();
        last_login_dttm = Date.parse(SQL.Connection.getColumnString(resultset, 1));
        if (last_login_dttm) {
            this.getMessageManager().add({
                type: "I",
                text: "Welcome back! You last logged in"
                    + " on " + last_login_dttm.format("dd/MM/yy")
                    + " at " + last_login_dttm.format("HH:mm"),
            });
        } else {
            this.getMessageManager().add({
                type: "I",
                text: "This is your first log-in",
            });
        }
    } catch (e) {
        this.report(e);
    } finally {
        SQL.Connection.finishedWithResultSet(resultset);
    }
});


Access.Session.reassign("newVisit", function (page_id, page_title, params, page_key) {
    var sql;
    this.visits += 1;
    sql = "INSERT INTO ac_visit ( id, session_id, _key, page, title, date_time, page_key, parameters ) VALUES ( " +
        this.visits + ", " + this.id + ", " +
        SQL.Connection.escape(this.id + "." + this.visits) + ", " +
        SQL.Connection.escape(page_id) + ", " +
        SQL.Connection.escape(page_title, 100) + ", NOW(), " +
        SQL.Connection.escape(page_key, 80) + ", ";
    if (params) {
        sql += SQL.Connection.escape(this.view.call(params, "block"));
    } else {
        sql += "NULL";
    }
    SQL.Connection.shared.executeUpdate(sql + " )");
    return this.visits;
});


Access.Session.reassign("updateVisit", function (trans, start_time) {
    var sql;
    this.messages.trans = trans;
    sql = "UPDATE ac_visit SET " +
        "  tx = " + SQL.Connection.escape(trans ? trans.id : null) +
        ", messages = " + SQL.Connection.escape(this.messages.getString("\n", "I")) +
        ", warnings = " + SQL.Connection.escape(this.messages.getString("\n", "W")) +
        ", errors   = " + SQL.Connection.escape(this.messages.getString("\n", "E"));
    if (start_time) {
        sql += ", post_server = " + ((new Date().getTime()) - start_time);
    }
    sql += " WHERE _key = " + SQL.Connection.escape(this.id + "." + this.visits);
    SQL.Connection.shared.executeUpdate(sql);
    this.messages.clear("record");
});
