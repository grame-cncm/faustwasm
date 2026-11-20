/*
 * faust-params.js -- the script of a [js faust-params.js] object: phones
 * drive any Max patch through its named parameters (Parameter Mode Enable,
 * the live.* objects), with faust-remote.js and `target params`.
 *
 * - It lists the patch's named parameters (ParameterInfoProvider) and
 *   builds a Faust JSON from them, so that the phone's remote control
 *   shows them as a Faust DSP's controls: a slider for a float, a number
 *   box for an integer, a checkbox for a two-state enum, a menu for a
 *   longer one. Sent as `json <text>`, with every current value, again on
 *   `getjson`.
 * - It follows their changes (ParameterListener) and sends them as
 *   `pvalues <name> <value> ...`; `pset <name> <value>` from the phones
 *   sets a parameter, as if it had been moved in the patch.
 * - Bargraphs: names given after `meters` in the object's arguments, each
 *   `name` (range 0 to 1) or `name:min:max`, are added to the JSON as
 *   bargraphs; send their values in as `meter <name> <value>`.
 *
 * Arguments: [js faust-params.js name <dsp name> meters <name...>], both
 * optional; the name defaults to the patcher's.
 *
 * Instead of the JSON this builds, a Faust interface can describe the
 * phone's controls (groups, [acc:...] sensors, [remote:off]): give
 * faust-remote.js its JSON with `ui <file>`; parameters are then matched
 * by the widgets' labels.
 *
 * Classic js (ES5), so that it runs in Max 8 as in Max 9.
 */
inlets = 1;
outlets = 1;

var provider = null;
var listeners = {};
var json = null;
var latest = {};
var sent = {};

/** The object's arguments: `name`, and the bargraphs after `meters`. */
function options() {
    var result = { name: null, meters: [] };
    var args = typeof jsarguments !== "undefined" ? jsarguments : [];
    for (var i = 1; i < args.length; i++) {
        if (args[i] === "name" && i + 1 < args.length) {
            result.name = String(args[++i]);
        } else if (args[i] === "meters") {
            for (i = i + 1; i < args.length; i++) {
                var parts = String(args[i]).split(":");
                result.meters.push({
                    name: parts[0],
                    min: parts.length > 1 ? Number(parts[1]) : 0,
                    max: parts.length > 2 ? Number(parts[2]) : 1
                });
            }
        }
    }
    return result;
}

/** A label as a Faust path segment, as Faust's PathBuilder makes it. */
function segment(label) {
    return String(label).replace(/[\/ #*,?\[\]{}()]/g, "_");
}

/** The entries of an enum parameter, if getinfo gives them. */
function entries(info) {
    var list = info["enum"];
    if (list === undefined || list === null) return null;
    if (typeof list === "string") list = list.split(" ");
    var result = [];
    for (var i = 0; i < list.length; i++) result.push(String(list[i]));
    return result;
}

function number(x, fallback) {
    var n = Number(x);
    return isFinite(n) ? n : fallback;
}

/** The current value of a named parameter. */
function valueOf(name) {
    var listener = listeners[name];
    var value = listener ? listener.getvalue() : 0;
    if (value instanceof Array) value = value[0];
    return number(value, 0);
}

/** The Faust UI item for a named parameter, or null if it has no number. */
function item(name, info, top, index) {
    var type = String(info.type || "").toLowerCase();
    var address = "/" + top + "/" + segment(name);
    var base = { label: name, shortname: name, address: address, index: index, meta: [] };
    var init = valueOf(name);
    if (type === "enum") {
        var list = entries(info) || [];
        var count = list.length || Math.round(number(info.max, 1) - number(info.min, 0)) + 1;
        if (count === 2) {
            base.type = "checkbox";
            return base;
        }
        var menu = [];
        for (var i = 0; i < list.length; i++) menu.push("'" + list[i] + "':" + i);
        base.type = "nentry";
        base.init = init;
        base.min = 0;
        base.max = count - 1;
        base.step = 1;
        if (menu.length) base.meta = [{ style: "menu{" + menu.join(";") + "}" }];
        return base;
    }
    if (type !== "float" && type !== "int") return null;
    var min = number(info.min, 0);
    var max = number(info.max, 1);
    base.type = type === "int" ? "nentry" : "hslider";
    base.init = init;
    base.min = min;
    base.max = max;
    base.step = type === "int" ? 1 : (max - min) / 1000 || 0.001;
    return base;
}

/** List the parameters, follow them, and build the JSON. */
function build() {
    var opts = options();
    var top = segment(opts.name || (this.patcher && this.patcher.name) || "max");
    provider = provider || new ParameterInfoProvider(changed);
    for (var old in listeners) listeners[old].silent = 1;
    listeners = {};
    var items = [];
    var names = provider.getnames();
    for (var i = 0; i < names.length; i++) {
        var name = String(names[i]);
        var info = provider.getinfo(name);
        if (!info) continue;
        listeners[name] = new ParameterListener(name, moved);
        var made = item(name, info, top, items.length * 8);
        if (made) items.push(made);
        else delete listeners[name];
    }
    for (var m = 0; m < opts.meters.length; m++) {
        var meter = opts.meters[m];
        items.push({
            type: "hbargraph",
            label: meter.name,
            shortname: meter.name,
            address: "/" + top + "/" + segment(meter.name),
            index: items.length * 8,
            min: meter.min,
            max: meter.max,
            meta: []
        });
    }
    json = JSON.stringify({
        name: top,
        filename: top + ".dsp",
        version: "",
        compile_options: "",
        library_list: [],
        include_pathnames: [],
        size: 0,
        inputs: 0,
        outputs: 0,
        meta: [],
        ui: [{ type: "vgroup", label: top, items: items }]
    });
    outlet(0, "json", json);
    // And every current value, for a host whose interface comes from a file
    // (its init values are not the patch's)
    sent = {};
    for (var known in listeners) latest[known] = valueOf(known);
}

/** Parameters were added or removed: the JSON changes. */
function changed() {
    build();
}

/** A parameter moved, in the patch or by `pset`. */
function moved(data) {
    var value = data.value instanceof Array ? data.value[0] : data.value;
    latest[String(data.name)] = number(value, 0);
}

function flush() {
    var out = ["pvalues"];
    for (var name in latest) {
        if (sent[name] !== latest[name]) {
            out.push(name, latest[name]);
            sent[name] = latest[name];
        }
    }
    if (out.length > 1) outlet(0, out);
}

var task = new Task(flush, this);
task.interval = 33;
task.repeat();

/** The JSON and every current value, built again: the patch may have changed. */
function getjson() {
    build();
}

function pset(name, value) {
    var listener = listeners[String(name)];
    if (listener) listener.setvalue(Number(value));
}

function meter(name, value) {
    latest[String(name)] = Number(value);
}

function loadbang() {
    build();
}

function notifydeleted() {
    task.cancel();
}
