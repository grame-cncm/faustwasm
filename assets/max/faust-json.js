/*
 * faust-json.js -- the script of a [js faust-json.js] object, in the same
 * patcher as a faustgen~, for faust-remote.js.
 *
 * - faustgen~ sends its JSON to every js object of its patcher when it
 *   compiles a DSP: this object keeps it and passes it on as
 *   `json <text>`, and gives it again on `getjson`. Place it before the
 *   faustgen~ in the patch (create it first), so that it exists when the
 *   faustgen~ compiles at load.
 * - faustgen~'s control outlet, connected to the inlet, reports every
 *   bargraph at every audio block, and every control after `dump`: this
 *   object keeps the latest value of each and sends the ones that changed
 *   at most 30 times a second, as `values <path> <value> ...`.
 *
 * Classic js (ES5), so that it runs in Max 8 as in Max 9.
 */
inlets = 1;
outlets = 1;

var json = null;
var latest = {};
var sent = {};

function flush() {
    var out = ["values"];
    for (var address in latest) {
        if (sent[address] !== latest[address]) {
            out.push(address, latest[address]);
            sent[address] = latest[address];
        }
    }
    if (out.length > 1) outlet(0, out);
}

var task = new Task(flush, this);
task.interval = 33;
task.repeat();

function getjson() {
    if (json !== null) outlet(0, "json", json);
}

function anything() {
    var args = arrayfromargs(messagename, arguments);
    // From faustgen~ when it compiles: the message "anything" and the JSON
    if (messagename === "anything") {
        if (args.length > 1 && String(args[1]).charAt(0) === "{") {
            json = String(args[1]);
            latest = {};
            sent = {};
            outlet(0, "json", json);
        }
        return;
    }
    // From the control outlet: [path, current, min, max], which faustgen~
    // sends as a list (the path is then its first element)
    if (messagename.charAt(0) === "/" && args.length > 1) latest[messagename] = args[1];
}

function list() {
    var args = arrayfromargs(arguments);
    if (args.length > 1 && String(args[0]).charAt(0) === "/") latest[String(args[0])] = args[1];
}

function notifydeleted() {
    task.cancel();
}
